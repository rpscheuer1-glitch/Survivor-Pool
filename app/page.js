"use client";
import Link from "next/link";
import { useAuth } from "../lib/useAuth";

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="text-center py-16">
      <h1 className="text-3xl font-black uppercase tracking-wide mb-4">Welcome to the pool</h1>
      <p className="text-chalk/70 mb-8 max-w-md mx-auto">
        Sign up (or log in) to see or create your entries, make your weekly picks, and check the weekly summary.
      </p>
      {!loading && (
        <div className="flex justify-center gap-4">
          {user ? (
            <Link href="/dashboard" className="btn-primary">Go to my entries</Link>
          ) : (
            <>
              <Link href="/signup" className="btn-primary">Sign up</Link>
              <Link href="/login" className="btn-ghost">Log in</Link>
            </>
          )}
          <Link href="/standings" className="btn-ghost">View weekly summary</Link>
        </div>
      )}
    </div>
  );
}
