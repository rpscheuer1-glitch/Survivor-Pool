"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/reset-password`;
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(false);
    if (resetErr) {
      setError(resetErr.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-black uppercase mb-4">Check your email</h1>
        <p className="text-sm text-chalk/60">
          If an account exists for {email}, a password reset link is on its way. Click it to set a new password.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto">
      <h1 className="text-xl font-black uppercase mb-4">Reset your password</h1>
      <p className="text-sm text-chalk/60 mb-4">Enter the email you signed up with and we'll send you a reset link.</p>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <div>
          <label className="text-xs text-chalk/60">Email</label>
          <input type="email" className="w-full mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      </form>
    </div>
  );
}
