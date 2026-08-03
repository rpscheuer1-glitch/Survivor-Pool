"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import GoogleSignInButton from "../GoogleSignInButton";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [checkingLock, setCheckingLock] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pool_settings").select("signups_locked").eq("id", 1).single();
      setLocked(!!data?.signups_locked);
      setCheckingLock(false);
    })();
  }, []);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const { data, error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    setBusy(false);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    if (data.session) {
      router.push("/dashboard");
    } else {
      setNotice("Check your email to confirm your account, then log in.");
    }
  };

  if (checkingLock) return null;

  if (locked) {
    return (
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-black uppercase mb-4">Signups are closed</h1>
        <p className="text-sm text-chalk/60">
          This pool isn't accepting new sign-ups right now. If you think that's a mistake, reach out to whoever's running it.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto">
      <h1 className="text-xl font-black uppercase mb-4">Create your account</h1>
      <GoogleSignInButton />
      <div className="flex items-center gap-3 my-4">
        <div className="h-px bg-turfline flex-1" />
        <span className="text-xs text-chalk/40">or</span>
        <div className="h-px bg-turfline flex-1" />
      </div>
      <form onSubmit={handleSignup} className="grid gap-3">
        <div>
          <label className="text-xs text-chalk/60">Name</label>
          <input className="w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-chalk/60">Email</label>
          <input type="email" className="w-full mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-chalk/60">Password (6+ characters)</label>
          <input type="password" className="w-full mt-1" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        {notice && <p className="text-leaf text-sm">{notice}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Sign up"}</button>
      </form>
    </div>
  );
}

