"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/db/browser";

// Magic-link auth for BOTH sellers and buyers (AGENT_SPEC §1), with a 6-digit
// code fallback: the email carries both a sign-in link and {{ .Token }}, so a
// user whose link was consumed (inbox prefetch) or who reads mail on another
// device can type the code instead. verifyOtp(type "email") accepts the OTP
// for both magic-link and first-time-signup emails.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Surface auth-callback failures (?error=...) instead of a silent loop.
  useEffect(() => {
    const msg = new URLSearchParams(window.location.search).get("error");
    if (msg) setErr(msg);
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setVerifying(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setVerifying(false);
    if (error) {
      setErr(
        `Code not accepted: ${error.message}. Codes are single-use and expire — ` +
          `request a new email if needed.`,
      );
    } else {
      window.location.assign("/");
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold tracking-tight">
        DealDesk<span className="text-[color:var(--color-accent)]">.</span>
      </h1>
      <p className="mb-6 text-sm text-slate-500">Secure sell-side data room</p>
      <div className="card">
        {sent ? (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-sm text-slate-700">
              Check <strong>{email}</strong> for a sign-in link — or enter the
              6-digit code from that email here:
            </p>
            <input
              className="input tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button
              className="btn-primary w-full"
              disabled={code.length !== 6 || verifying}
            >
              {verifying ? "Verifying…" : "Sign in with code"}
            </button>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              type="button"
              className="w-full text-xs text-slate-400 underline"
              onClick={() => {
                setSent(false);
                setCode("");
                setErr(null);
              }}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <label className="text-sm font-medium">Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@firm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn-primary w-full">Send magic link</button>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
