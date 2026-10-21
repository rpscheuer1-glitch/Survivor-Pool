import { fetchAllRows } from "../../../../lib/supabaseClient";
import { getServiceClient } from "../../../../lib/supabaseAdmin";
import {
  ROUNDS,
  roundName,
  pickLabel,
  roundLockTime,
  picksOpen,
  formatCentral,
  autoPickFor,
  computePlayoffStatus,
  groupGamesByRound,
  picksFromRows,
} from "../../../../lib/playoffLogic";
import { sendBulkEmail } from "../../../../lib/serverEmail";
import { sendPushMessages, pushConfigured } from "../../../../lib/serverPush";

export const maxDuration = 60;

// Triggered by Vercel Cron (see vercel.json) on playoff Friday, Saturday and
// Sunday mornings. Reminds every alive playoff entry without a pick while
// picks are open and lock within the next three days (an hour before the
// round's first kickoff). Protected by CRON_SECRET, same as the
// regular-season reminder.
export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = getServiceClient();
  if (!db) {
    return Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set in this deployment; no reminders were sent." },
      { status: 500 }
    );
  }

  const { data: settings, error: settingsErr } = await db.from("playoff_settings").select("*").eq("id", 1).maybeSingle();
  if (settingsErr || !settings?.visible) {
    return Response.json({ skipped: true, reason: "The playoff pool isn't set up or isn't showing yet." });
  }

  const now = new Date();
  const gamesByRound = groupGamesByRound(await fetchAllRows("playoff_games", "*", "id", db));

  // The round whose picks are open and lock soon.
  const windowMs = 72 * 60 * 60 * 1000;
  const round = ROUNDS.map((r) => r.round).find((r) => {
    const games = gamesByRound[r] || [];
    return picksOpen(games, now) && roundLockTime(games).getTime() - now.getTime() <= windowMs;
  });
  if (!round) {
    return Response.json({ skipped: true, reason: "No playoff pick deadline in the next three days." });
  }
  const auto = autoPickFor(gamesByRound[round]);

  const entries = await fetchAllRows("playoff_entries", "*", "created_at", db);
  const picksByEntry = picksFromRows(await fetchAllRows("playoff_picks", "*", "id", db));

  const missingEmails = new Set();
  const missingUserIds = new Set();
  entries.forEach((e) => {
    const status = computePlayoffStatus(picksByEntry[e.id] || {}, gamesByRound, now);
    const result = status.detail[round]?.result;
    // "upcoming" = no pick; "invalid" = a pick on a game that was removed.
    if (result === "upcoming" || result === "invalid") {
      if (e.email) missingEmails.add(e.email);
      if (e.user_id) missingUserIds.add(e.user_id);
    }
  });

  if (missingEmails.size === 0) {
    return Response.json({ skipped: true, reason: "Every alive playoff entry has a pick in.", round });
  }

  const name = roundName(round);
  const deadline = formatCentral(roundLockTime(gamesByRound[round]));
  const autoText = auto ? pickLabel(auto.game, auto.choice) : null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const subject = `Reminder: ${name} playoff pick still needed`;
  const message =
    `Hey — you still need a ${name} pick for at least one of your playoff entries.\n\n` +
    `Picks lock ${deadline}, an hour before the first game.` +
    (autoText ? ` Any entry without a pick by then gets the biggest favorite, ${autoText}.` : "") +
    (siteUrl ? `\n\nPick here: ${siteUrl}/playoffs` : "") +
    "\n\nThanks!";

  const result = await sendBulkEmail({ subject, message, recipients: Array.from(missingEmails) });

  const push = pushConfigured()
    ? await sendPushMessages(
        db,
        Array.from(missingUserIds).map((userId) => ({
          userId,
          title: `${name} playoff pick still needed`,
          body: autoText ? `Pick before ${deadline} or you'll get ${autoText}.` : `Picks lock ${deadline}.`,
          url: "/playoffs",
        }))
      )
    : { skipped: "Push not configured." };

  return Response.json({ round, ...result, push });
}
