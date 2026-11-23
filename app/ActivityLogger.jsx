"use client";
import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

// Invisible. Tells the server once per browser tab (per account) that this
// person signed in or opened the site, so their IP/device gets recorded in
// activity_log. Never shows anything or blocks the page.
export default function ActivityLogger() {
  useEffect(() => {
    // Coming back from "Continue with Google" lands here with a token/code in
    // the URL -- count that as a sign-in rather than an ordinary visit.
    const fromOAuth =
      typeof window !== "undefined" &&
      (window.location.hash.includes("access_token") || new URLSearchParams(window.location.search).has("code"));
    let hadSession = null;

    const send = (session, event) => {
      if (!session?.access_token || !session.user?.id) return;
      const key = `activity-logged:${session.user.id}`;
      try {
        if (event === "visit" && sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {}
      fetch("/api/log-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ event }),
        keepalive: true,
      }).catch(() => {});
    };

    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === "INITIAL_SESSION") {
        hadSession = !!session;
        if (session) send(session, fromOAuth ? "sign_in" : "visit");
      } else if (evt === "SIGNED_IN" && session && hadSession === false) {
        hadSession = true;
        send(session, "sign_in");
      } else if (evt === "SIGNED_OUT") {
        hadSession = false;
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
