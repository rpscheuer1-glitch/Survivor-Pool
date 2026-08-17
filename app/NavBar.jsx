"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/useAuth";
import { supabase } from "../lib/supabaseClient";

export default function NavBar() {
  const { user, isAdmin } = useAuth();
  const [poolName, setPoolName] = useState("Survivor Pool");
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pool_settings").select("pool_name").eq("id", 1).single();
      if (data?.pool_name) setPoolName(data.pool_name);
    })();
  }, [pathname]);

  return (
    <div className="border-b border-turfline px-5 py-3 flex items-center justify-between flex-wrap gap-3 sticky top-0 z-10" style={{ background: "#141B22" }}>
      <div className="flex items-center gap-2 font-black uppercase tracking-wide text-lg">
        <span>🏈</span>
        <span>{poolName}</span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Link href="/rules" className="hover:text-amber">Rules</Link>
        <Link href="/standings" className="hover:text-amber">Weekly Summary</Link>
        {user && <Link href="/dashboard" className="hover:text-amber">My Entries</Link>}
        {isAdmin && <Link href="/admin" className="hover:text-amber">Admin</Link>}
        {user ? (
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        ) : (
          <>
            <Link href="/login" className="hover:text-amber">Log in</Link>
            <Link href="/signup" className="btn-primary">Sign up</Link>
          </>
        )}
      </div>
    </div>
  );
}
