import { requireUser, ok, fail } from "@/lib/api";
import { z } from "zod";
import { sendEmail } from "@/lib/email/resend";
import { buyerInviteEmail } from "@/lib/email/templates";
import { writeAudit } from "@/lib/audit/writeAudit";

const inviteSchema = z.object({
  org_name: z.string().trim().min(1).max(255),
  contact_email: z.string().email(),
  folder_ids: z.array(z.string().uuid()).max(500).default([]),
});

// POST /api/deals/:dealId/buyers — invite a buyer + grant folder access,
// then send the invite email (Resend) and audit the invite (INV-4).
//
// Failure policy: the buyer row + folder grants are the security-relevant
// state and are created under RLS. The email is retriable and must NOT
// roll that back — on send failure we still return ok with
// { emailSent: false } so the seller console can surface a "resend" action.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase, user } = await requireUser();
    const input = inviteSchema.parse(await req.json());

    // RLS authorizes: only a deal admin can read the deal row. We also need
    // the deal name for the invite subject line.
    const { data: deal, error: dealErr } = await supabase
      .from("deals")
      .select("id, name")
      .eq("id", dealId)
      .single();
    if (dealErr) throw dealErr;

    const { data: buyer, error } = await supabase
      .from("buyers")
      .insert({
        deal_id: dealId,
        org_name: input.org_name,
        contact_email: input.contact_email,
      })
      .select("id")
      .single();
    if (error) throw error;

    if (input.folder_ids.length > 0) {
      const rows = input.folder_ids.map((folder_id) => ({
        buyer_id: buyer.id,
        folder_id,
      }));
      const { error: grantErr } = await supabase
        .from("buyer_folder_access")
        .insert(rows);
      if (grantErr) throw grantErr;
    }

    // Invite email. Absolute room URL; the buyer signs in by magic link on
    // arrival (Supabase Auth → Resend SMTP handles that message).
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    let emailSent = false;
    let emailError: string | undefined;
    if (appUrl && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
      const message = buyerInviteEmail({
        orgName: input.org_name,
        dealName: deal.name,
        roomUrl: `${appUrl}/room/${dealId}`,
      });
      const result = await sendEmail({
        to: input.contact_email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      emailSent = result.ok;
      emailError = result.error;
      if (!result.ok) {
        console.error(
          `buyer invite email failed (buyer ${buyer.id}):`,
          result.error,
        );
      }
    } else {
      const missing = [
        !appUrl && "NEXT_PUBLIC_APP_URL",
        !process.env.RESEND_API_KEY && "RESEND_API_KEY",
        !process.env.EMAIL_FROM && "EMAIL_FROM",
      ].filter(Boolean);
      emailError = `email env not configured — missing: ${missing.join(", ")}`;
    }

    // INV-4: an invite is a human release of access — part of the process record.
    await writeAudit({
      dealId,
      actorType: "seller",
      actorId: user.id,
      action: "human.buyer_invited",
      subjectId: buyer.id,
      payload: {
        org_name: input.org_name,
        contact_email: input.contact_email,
        folder_count: input.folder_ids.length,
        email_sent: emailSent,
        ...(emailError ? { email_error: emailError } : {}),
      },
    });

    return ok({ buyerId: buyer.id, emailSent });
  } catch (e) {
    return fail(e);
  }
}
