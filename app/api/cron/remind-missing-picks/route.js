import { supabase } from "../../../../lib/supabaseClient";
import { computeStatus } from "../../../../lib/poolLogic";
import { sendBulkEmail } from "../../../../lib/serverEmail";

// Triggered by Vercel Cron (see vercel.json) — not meant to be called by a
// browser. Protected by CRON_SECRET so random requests can't trigger a mass
// email; Vercel automatically sends this as the Authorization header for
// scheduled invocations once CRON_SECRET is set in your project's env vars.
export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: settingsRow } = await supabase.from("pool_settings").select("*").eq("id", 1).single();
  const week = settingsRow?.current_week;
  if (!week) return Response.json({ skipped: true, reason: "No current week set." });

  const { data: entries } = await supabase.from("entries").select("*");
  const { data: gameRows } = await supabase.from("games").select("*");
  const { data: weekRows } = await supabase.from("weeks").select("*");
  const { data: pickRows } = await supabase.from("picks").select("*");

  const gamesByWeek = {};
  (gameRows || []).forEach((g) => {
    gamesByWeek[g.week] = gamesByWeek[g.week] || [];
    gamesByWeek[g.week].push(g);
  });
  const finalByWeek = {};
  (weekRows || []).forEach((w) => (finalByWeek[w.week] = w.final));
  const picksByEntry = {};
  (pickRows || []).forEach((p) => {
    picksByEntry[p.entry_id] = picksByEntry[p.entry_id] || {};
    picksByEntry[p.entry_id][p.week] = { team: p.team, auto: p.auto_assigned };
  });

  const missingEmails = new Set();
  (entries || []).forEach((e) => {
    const status = computeStatus(picksByEntry[e.id] || {}, gamesByWeek, finalByWeek);
    const alreadyEliminated = status.eliminated && status.eliminatedWeek < week;
    const hasPick = !!(picksByEntry[e.id] && picksByEntry[e.id][week]);
    if (!alreadyEliminated && !hasPick && e.email) missingEmails.add(e.email);
  });

  if (missingEmails.size === 0) {
    return Response.json({ skipped: true, reason: "Everyone already has a pick in for this week.", week });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const subject = `Reminder: Week ${week} pick still needed`;
  const message = `Hey — just a reminder to get your Week ${week} survivor pick in before games start today.${siteUrl ? ` Pick here: ${siteUrl}/dashboard` : ""}\n\nThanks!`;

  const result = await sendBulkEmail({ subject, message, recipients: Array.from(missingEmails) });
  return Response.json({ week, ...result });
}
