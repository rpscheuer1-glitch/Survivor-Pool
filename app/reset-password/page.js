"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Clicking the emailed link lands here with a recovery token in the URL;
    // supabase-js automatically turns that into a real session on load.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setValidLink(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setValidLink(true);
      setChecking(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  };

  if (checking) return null;

  if (!validLink) {
    return (
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-black uppercase mb-4">Link expired or invalid</h1>
        <p className="text-sm text-chalk/60">
          This password reset link isn't valid anymore — they only work once and expire after a while. Request a new one from the login page.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-black uppercase mb-4">Password updated</h1>
        <p className="text-sm text-chalk/60">Taking you to your entries…</p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto">
      <h1 className="text-xl font-black uppercase mb-4">Set a new password</h1>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <div>
          <label className="text-xs text-chalk/60">New password (6+ characters)</label>
          <input type="password" className="w-full mt-1" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-chalk/60">Confirm new password</label>
          <input type="password" className="w-full mt-1" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      </form>
    </div>
  );
}
