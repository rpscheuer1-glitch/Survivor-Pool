"use client";
import { supabase } from "../lib/supabaseClient";

export default function GoogleSignInButton() {
  const handleClick = async () => {
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/dashboard`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-2 rounded-md py-2 text-sm font-bold"
      style={{ background: "#F5F2E8", color: "#141B22", border: "1px solid #3A4756" }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.6-5.2-11.6-11.6S17.6 12.3 24 12.3c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.3 29.2 4.3 24 4.3 12.9 4.3 4 13.2 4 24.3s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.8z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 12.3 24 12.3c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.3 29.2 4.3 24 4.3c-7.7 0-14.4 4.4-17.7 10.4z" />
        <path fill="#4CAF50" d="M24 44.3c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.1-11.3-7.6l-6.5 5c3.3 6.1 9.9 10.8 17.8 10.8z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.2 5.2c-.4.4 6.6-4.8 6.6-14.6 0-1.3-.1-2.6-.4-3.8z" />
      </svg>
      Continue with Google
    </button>
  );
}
