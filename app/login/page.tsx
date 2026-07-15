"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/db/browser";

// Magic-link auth for BOTH sellers and buyers (AGENT_SPEC §1).
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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

  return (
    <div className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold tracking-tight">
        DealDesk<span className="text-[color:var(--color-accent)]">.</span>
      </h1>
      <p className="mb-6 text-sm text-slate-500">Secure sell-side data room</p>
      <div className="card">
        {sent ? (
          <p className="text-sm text-slate-700">
            Check <strong>{email}</strong> for a sign-in link.
          </p>
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
