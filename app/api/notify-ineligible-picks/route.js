import { getRequestAdmin } from "../../../lib/requireAdmin";
import { getServiceClient } from "../../../lib/supabaseAdmin";
import { sendPushMessages, pushConfigured } from "../../../lib/serverPush";
import { pickProblem, describePickProblem, isLocked } from "../../../lib/poolLogic";

export const maxDuration = 60;

// Admin-only. Called right after the admin takes a game off the board,
// moves a spread over the week's limit, or swaps a team out of a game.
// Anyone whose saved pick (on one of `teams`) just stopped counting gets a
// phone push telling them to pick again.
//
// This runs server-side on purpose: the admin can't see picks before their
// game locks, so the admin only ever gets back a count -- never who, or which
// team. Nothing is written to the notices table either, since admins can read
// that. The pick itself is left alone; it simply counts as no pick (see
// pickProblem / computeStatus), and the player's dashboard says so.
//
// Body: { week, teams: [team, ...] }
export async function POST(request) {
  try {
    const admin = await getRequestAdmin(request);
    if (!admin) return Response.json({ error: "Not authorized." }, { status: 401 });
    const db = getServiceClient();
    if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 500 });

    const { week, teams } = await request.json();
    const wk = Number(week);
    const teamList = (Array.isArray(teams) ? teams : []).filter(Boolean);
    if (!wk || teamList.length === 0) return Response.json({ affected: 0, people: 0 });

    const { data: weekRow } = await db.from("weeks").select("*").eq("week", wk).maybeSingle();
    if (weekRow?.final) return Response.json({ affected: 0, people: 0 });

    const { data: gameRows, error: gErr } = await db.from("games").select("*").eq("week", wk);
    if (gErr) return Response.json({ error: gErr.message }, { status: 500 });
    const games = (gameRows || []).map((g) => ({
      ...g,
      weekend_lock_day: weekRow?.weekend_lock_day,
      weekend_lock_time: weekRow?.weekend_lock_time,
    }));
    const gamesByWeek = { [wk]: games };

    const picks = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("picks")
        .select("entry_id, team")
        .eq("week", wk)
        .in("team", teamList)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      picks.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const affected = picks
      .map((p) => ({ ...p, problem: pickProblem(p.team, wk, gamesByWeek) }))
      .filter((p) => {
        if (!p.problem) return false;
        // A game that already locked is final as picked -- nothing to redo.
        const game = games.find((g) => g.home === p.team || g.away === p.team);
        return !game || !isLocked(game);
      });
    if (affected.length === 0) return Response.json({ affected: 0, people: 0 });

    const entryIds = [...new Set(affected.map((p) => p.entry_id))];
    const entries = [];
    for (let i = 0; i < entryIds.length; i += 200) {
      const { data, error } = await db.from("entries").select("id, user_id, label").in("id", entryIds.slice(i, i + 200));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      entries.push(...(data || []));
    }
    const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));

    const linesByUser = {};
    affected.forEach((p) => {
      const entry = entryById[p.entry_id];
      if (!entry?.user_id) return;
      linesByUser[entry.user_id] = linesByUser[entry.user_id] || [];
      linesByUser[entry.user_id].push(`${entry.label}: ${p.team} — ${describePickProblem(p.problem)}`);
    });

    const people = Object.keys(linesByUser).length;
    const push = pushConfigured()
      ? await sendPushMessages(
          db,
          Object.entries(linesByUser).map(([userId, lines]) => ({
            userId,
            title: `Week ${wk}: please pick again`,
            body: `Your pick no longer counts:\n${lines.join("\n")}\nPick another team before the deadline.`,
            url: "/dashboard",
          }))
        )
      : { error: "Push notifications aren't configured." };

    return Response.json({ affected: affected.length, people, push });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
