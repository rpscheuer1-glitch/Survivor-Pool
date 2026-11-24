"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/useAuth";
import { supabase } from "../lib/supabaseClient";

// "Continue with Google" silently creates a brand-new account if the Google
// email doesn't match an existing one -- which is how a player once ended up
// with two accounts (an old Gmail he'd forgotten, plus his real email) and
// picks split between them. Right after a Google sign-up, spell out which
// email the new account is under, and offer a sign-out in case it's wrong.
const SHOW_FOR_MS = 24 * 60 * 60 * 1000; // keep reminding for a day unless confirmed

export default function NewGoogleAccountNotice() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);

  const key = user ? `google-new-account-ok:${user.id}` : null;

  useEffect(() => {
    if (!user) { setShow(false); return; }
    const viaGoogle = user.app_metadata?.provider === "google";
    const created = user.created_at ? new Date(user.created_at).getTime() : 0;
    const isNew = created && Date.now() - created < SHOW_FOR_MS;
    let confirmed = false;
    try { confirmed = !!localStorage.getItem(key); } catch {}
    setShow(viaGoogle && isNew && !confirmed);
  }, [user, key]);

  if (!show) return null;

  const confirm = () => {
    try { localStorage.setItem(key, "1"); } catch {}
    setShow(false);
  };

  return (
    <div
      className="rounded-lg px-4 py-3 border-l-4 mb-6"
      style={{ background: "rgba(242,102,26,0.12)", borderColor: "#F2661A" }}
    >
      <div className="font-black">New account created for {user.email}</div>
      <div className="text-sm text-chalk/80 mt-1">
        Signing in with Google just made a new pool account under <b>{user.email}</b>.
        If you already have a pool account under a different email, sign out now and log in
        with that one. Otherwise you'll have two separate accounts with separate entries and picks.
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn-primary" onClick={confirm}>That's me, keep this account</button>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
