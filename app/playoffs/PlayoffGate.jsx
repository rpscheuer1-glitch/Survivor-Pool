"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth";
import { supabase } from "../../lib/supabaseClient";

// Keeps the playoff section hidden from everyone but admins until
// Admin > Playoffs > "Show the playoff pool" is turned on.
export default function PlayoffGate({ children }) {
  const { isAdmin, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const [settings, setSettings] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("playoff_settings").select("*").eq("id", 1).maybeSingle();
      setSettings(data || null);
      setChecked(true);
    })();
  }, []);

  if (!checked || authLoading) return <p className="text-chalk/60">Loading…</p>;

  if (!settings?.visible && !isAdmin) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-black uppercase mb-3">Playoff pool</h1>
        <p className="text-sm text-chalk/60">The playoff pool isn't open yet. Check back after the regular season.</p>
      </div>
    );
  }

  const tabs = [
    { href: "/playoffs", label: "My Playoff Entries" },
    { href: "/playoffs/standings", label: "Playoff Summary" },
    { href: "/playoffs/rules", label: "Playoff Rules" },
  ];

  return (
    <div>
      {!settings && (
        <p className="text-rust text-sm mb-4">
          The playoff tables aren't set up yet. Run supabase/playoffs.sql in Supabase's SQL Editor.
        </p>
      )}
      {settings && !settings.visible && (
        <p className="text-amber text-sm mb-4">
          Hidden — only admins can see the playoff pool right now. Turn it on in Admin &gt; Playoffs.
        </p>
      )}
      <div className="flex gap-2 mb-6 border-b border-turfline overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="px-4 py-2 text-sm font-bold whitespace-nowrap"
            style={{
              borderBottom: pathname === t.href ? "3px solid #F2661A" : "3px solid transparent",
              color: pathname === t.href ? "#EDEFF2" : "rgba(237,239,242,0.55)",
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
