"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import GoogleSignInButton from "../GoogleSignInButton";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className="max-w-sm mx-auto">
      <h1 className="text-xl font-black uppercase mb-4">Log in</h1>
      <GoogleSignInButton />
      <div className="flex items-center gap-3 my-4">
        <div className="h-px bg-turfline flex-1" />
        <span className="text-xs text-chalk/40">or</span>
        <div className="h-px bg-turfline flex-1" />
      </div>
      <form onSubmit={handleLogin} className="grid gap-3">
        <div>
          <label className="text-xs text-chalk/60">Email</label>
          <input type="email" className="w-full mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-chalk/60">Password</label>
          <input type="password" className="w-full mt-1" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}
