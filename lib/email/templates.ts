/**
 * lib/email/templates.ts
 *
 * Email bodies. Design rules (spec §8 applies to email too): restraint.
 * This is a room where people sell companies — no images, no marketing
 * flourish, table-based layout, system fonts, works in dark mode, and a
 * plain-text part for every message.
 *
 * The Supabase MAGIC LINK template is not here — it lives in the Supabase
 * dashboard (Authentication → Email Templates). The canonical copy of that
 * HTML is docs/email-templates/magic-link.html; paste-to-dashboard is the
 * deploy step (see RUNBOOK).
 */

const BRAND = "DealDesk";
const ACCENT = "#1f3864";

function shell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e3e5e8;border-radius:8px;">
          <tr><td style="padding:28px 36px 0 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="font-size:15px;font-weight:700;letter-spacing:0.4px;color:${ACCENT};">${BRAND}</div>
          </td></tr>
          <tr><td style="padding:20px 36px 28px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1d21;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td></tr>
        </table>
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr><td style="padding:16px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a9099;font-size:12px;line-height:1.5;">
            This message relates to a confidential process. If you received it in error, please delete it and notify the sender.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="border-radius:6px;background-color:${ACCENT};">
      <a href="${href}" style="display:inline-block;padding:11px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;
}

export interface BuyerInviteParams {
  /** Buyer's organization, e.g. "Crestline Capital Partners". */
  orgName: string;
  /** Deal display name, e.g. "Project Meridian". */
  dealName: string;
  /** Absolute URL of the buyer room, e.g. https://app.example.com/room/<dealId>. */
  roomUrl: string;
}

export function buyerInviteEmail(p: BuyerInviteParams): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `You have been granted access to the ${p.dealName} data room`;
  const html = shell(`
    <p style="margin:0 0 16px 0;">Dear ${p.orgName} team,</p>
    <p style="margin:0 0 16px 0;">
      You have been granted access to the <strong>${p.dealName}</strong> data room
      for the purposes of your evaluation. The room contains the document index
      you are permitted to review, and an analyst channel for diligence questions —
      every answer is drawn exclusively from the deal materials and cites its source.
    </p>
    ${button(p.roomUrl, "Enter the data room")}
    <p style="margin:0 0 16px 0;">
      When you first visit, you will be asked for this email address and sent a
      one-time sign-in link. Access is issued to this address individually and
      should not be forwarded.
    </p>
    <p style="margin:0;color:#5a6068;">If you were not expecting this invitation, no action is required.</p>
  `);
  const text = [
    `Dear ${p.orgName} team,`,
    ``,
    `You have been granted access to the ${p.dealName} data room for the purposes of your evaluation.`,
    ``,
    `Enter the data room: ${p.roomUrl}`,
    ``,
    `When you first visit, you will be asked for this email address and sent a one-time sign-in link. Access is issued to this address individually and should not be forwarded.`,
    ``,
    `If you were not expecting this invitation, no action is required.`,
  ].join("\n");
  return { subject, html, text };
}
