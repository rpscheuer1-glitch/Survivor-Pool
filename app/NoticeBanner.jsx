"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/useAuth";
import { supabase } from "../lib/supabaseClient";

// Announcements from Admin > Announcements (and personal ones like "your pick
// was auto-assigned"), shown at the top of every page until the person taps
// "Got it". Dismissals are saved to their account, so it stays gone on every
// device.
export default function NoticeBanner() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    if (!user) { setNotices([]); return; }
    (async () => {
      // Filter to this person's own + everyone's explicitly: admins can read
      // every notice, and shouldn't see other people's personal ones here.
      const { data: rows } = await supabase
        .from("notices")
        .select("*")
        .or(`user_id.is.null,user_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(20);
      const now = Date.now();
      const active = (rows || []).filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now);
      if (active.length === 0) { setNotices([]); return; }
      const { data: dismissed } = await supabase
        .from("notice_dismissals")
        .select("notice_id")
        .in("notice_id", active.map((r) => r.id));
      const dismissedIds = new Set((dismissed || []).map((d) => d.notice_id));
      setNotices(active.filter((r) => !dismissedIds.has(r.id)));
    })();
  }, [user, pathname]);

  const dismiss = async (id) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notice_dismissals").insert({ notice_id: id, user_id: user.id });
  };

  if (notices.length === 0) return null;

  return (
    <div className="grid gap-3 mb-6">
      {notices.map((n) => (
        <div
          key={n.id}
          className="rounded-lg px-4 py-3 border-l-4"
          style={{ background: "rgba(242,102,26,0.12)", borderColor: "#F2661A" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-black">{n.title}</div>
              {n.body && <div className="text-sm text-chalk/80 whitespace-pre-wrap mt-1">{n.body}</div>}
              <div className="text-xs text-chalk/40 mt-1">
                {new Date(n.created_at).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
            <button className="btn-ghost flex-shrink-0" onClick={() => dismiss(n.id)}>Got it</button>
          </div>
        </div>
      ))}
    </div>
  );
}
