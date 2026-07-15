/**
 * lib/email/resend.ts
 *
 * Transactional email via the Resend REST API. Server-only — the API key
 * must never reach the client bundle.
 *
 * Raw fetch (no SDK) to match the repo's convention for external services
 * (see lib/ingest/embed.ts): the retry/error policy stays fully ours and the
 * dependency surface stays small.
 *
 * Required env:
 *   RESEND_API_KEY  — a "sending access" key (least privilege)
 *   EMAIL_FROM      — RFC 5322 sender on the verified domain,
 *                     e.g. `DealDesk <deals@mail.example.com>`
 */
import "server-only";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always provide one — spam filters care. */
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend email id on success — store it in the audit payload. */
  id?: string;
  error?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Email cannot be sent ` +
        `without it — see .env.example.`,
    );
  }
  return v;
}

/**
 * Send one email. Never throws on delivery failure — callers decide whether
 * a failed email fails the surrounding operation (for buyer invites it must
 * NOT: the buyer row + grants are the security-relevant state; the email is
 * retriable). Missing env DOES throw, because that is a deploy defect.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const key = requireEnv("RESEND_API_KEY");
  const from = requireEnv("EMAIL_FROM");

  try {
    const res = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 500)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
