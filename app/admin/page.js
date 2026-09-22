"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import { ruleLabel, spreadLabel, computeStatus, computeFallbackPick, weekFullyLocked, computeAutoCurrentWeek, isLocked } from "../../lib/poolLogic";
import { TEAMS } from "../../lib/teams";

export default function AdminPage() {
  const router = useRouter();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [adminTab, setAdminTab] = useState("games");

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) router.push("/");
  }, [authLoading, user, isAdmin, router]);

  if (authLoading || !isAdmin) return <p className="text-chalk/60">Loading…</p>;

  return (
    <div>
      <div className="flex gap-2 mb-6 border-b border-turfline">
        {[
          { id: "games", label: "Games & Weeks" },
          { id: "roster", label: "Roster & Payments" },
          { id: "picks", label: "Manage Picks" },
          { id: "email", label: "Email" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setAdminTab(t.id)}
            className="px-4 py-2 text-sm font-bold"
            style={{
              borderBottom: adminTab === t.id ? "3px solid #F2661A" : "3px solid transparent",
              color: adminTab === t.id ? "#EDEFF2" : "rgba(237,239,242,0.55)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {adminTab === "games" && <GamesTab />}
      {adminTab === "roster" && <RosterTab />}
      {adminTab === "picks" && <ManagePicksTab />}
      {adminTab === "email" && <EmailTab /> }
    </div>
  );
}

// ------------------------------------------------------------------
// Games & Weeks (pool settings, schedule sync, per-week game editor)
// ------------------------------------------------------------------
function GamesTab() {
  const [settings, setSettings] = useState({ current_week: 1, pool_name: "Survivor Pool", signups_locked: false });
  const [poolNameInput, setPoolNameInput] = useState("");
  const [poolNameSaved, setPoolNameSaved] = useState(false);
  const [editWeek, setEditWeek] = useState(1);
  const [games, setGames] = useState([]);
  const [weekFinal, setWeekFinal] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");

  const [kickoffDate, setKickoffDate] = useState("2026-09-10");
  const [scheduleGames, setScheduleGames] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsMessage, setResultsMessage] = useState("");
  const [resultsError, setResultsError] = useState("");

  const [lockInBusy, setLockInBusy] = useState(false);
  const [lockInResult, setLockInResult] = useState(null);
  const [lockInError, setLockInError] = useState("");

  const [allGamesByWeek, setAllGamesByWeek] = useState({});

  const [weekendLockDay, setWeekendLockDay] = useState("sunday");
  const [weekendLockTime, setWeekendLockTime] = useState("10:00");
  const [lockSettingsSaved, setLockSettingsSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadingData(true);
    const { data: settingsRow } = await supabase.from("pool_settings").select("*").eq("id", 1).single();
    if (settingsRow) {
      setSettings(settingsRow);
      setPoolNameInput(settingsRow.pool_name || "");
    }

    const { data: gameRows } = await supabase.from("games").select("*").eq("week", editWeek);
    const sorted = (gameRows || []).slice().sort((a, b) => (a.game_date || "9999-99-99").localeCompare(b.game_date || "9999-99-99"));
    setGames(sorted);

    const { data: allGameRows } = await supabase.from("games").select("*");
    const gbw = {};
    (allGameRows || []).forEach((g) => {
      gbw[g.week] = gbw[g.week] || [];
      gbw[g.week].push(g);
    });
    setAllGamesByWeek(gbw);

    const { data: weekRow } = await supabase.from("weeks").select("*").eq("week", editWeek).maybeSingle();
    setWeekFinal(weekRow?.final || false);
    setWeekendLockDay(weekRow?.weekend_lock_day || "sunday");
    setWeekendLockTime(weekRow?.weekend_lock_time || "10:00");
    setLoadingData(false);
  }, [editWeek]);

  useEffect(() => { load(); }, [load]);

  const saveLockSettings = async (day, time) => {
    const { error: upErr } = await supabase
      .from("weeks")
      .upsert({ week: editWeek, weekend_lock_day: day, weekend_lock_time: time }, { onConflict: "week" });
    if (upErr) { setError(upErr.message); return; }
    setWeekendLockDay(day);
    setWeekendLockTime(time);
    setLockSettingsSaved(true);
    setTimeout(() => setLockSettingsSaved(false), 1500);
  };

  const savePoolName = async () => {
    const { error: err } = await supabase.from("pool_settings").update({ pool_name: poolNameInput }).eq("id", 1);
    if (err) { setError(err.message); return; }
    setSettings((s) => ({ ...s, pool_name: poolNameInput }));
    setPoolNameSaved(true);
    setTimeout(() => setPoolNameSaved(false), 1500);
  };

  const [lockError, setLockError] = useState("");
  const [lockSaved, setLockSaved] = useState(false);

  const toggleSignupsLocked = async () => {
    const next = !settings.signups_locked;
    setLockError("");
    const { error: err } = await supabase.from("pool_settings").update({ signups_locked: next }).eq("id", 1);
    if (err) { setLockError(err.message); return; }
    setSettings((s) => ({ ...s, signups_locked: next }));
    setLockSaved(true);
    setTimeout(() => setLockSaved(false), 1500);
  };

  const addGame = async (overrides = {}) => {
    const { data, error: insErr } = await supabase
      .from("games")
      .insert({ week: editWeek, home: TEAMS[0], away: TEAMS[1], spread: 0, winner: null, ...overrides })
      .select()
      .single();
    if (insErr) { setError(insErr.message); return; }
    setGames((prev) => [...prev, data]);
  };

  // Prefers deriving the target week's date window from Week 1's actual
  // loaded games (earliest game_date + 7 days per week) rather than trusting
  // the manually-typed kickoff field every time -- that field only matters
  // for bootstrapping before Week 1 has any games in it yet.
  const getWeekStartDate = async (week) => {
    const { data: week1Games } = await supabase
      .from("games")
      .select("game_date")
      .eq("week", 1)
      .not("game_date", "is", null);

    let base;
    if (week1Games && week1Games.length > 0) {
      // Use the median game date, not the earliest -- a single early one-off
      // game (like a Wednesday opener) would otherwise shift every future
      // week's calculated range by that same amount. The median sits inside
      // the main Thu/Sun/Mon cluster even with one early or late outlier.
      const sortedDates = week1Games.map((g) => g.game_date).sort();
      const median = sortedDates[Math.floor(sortedDates.length / 2)];
      const [y, m, d] = median.split("-").map(Number);
      base = new Date(Date.UTC(y, m - 1, d));
      base.setUTCDate(base.getUTCDate() - 3); // approximate that week's Thursday from a mid-week date
    } else {
      base = new Date(kickoffDate + "T00:00:00Z");
    }
    base.setUTCDate(base.getUTCDate() + (week - 1) * 7);
    return base.toISOString().slice(0, 10);
  };

  const fetchSchedule = async () => {
    setScheduleLoading(true);
    setScheduleError("");
    setScheduleGames([]);
    try {
      const startStr = await getWeekStartDate(editWeek);
      const res = await fetch(`/api/schedule?start=${startStr}&days=8`);
      const json = await res.json();
      if (json.error) {
        setScheduleError(json.error);
      } else {
        setScheduleGames(json.games);
        if (json.games.length === 0) setScheduleError("No games found in that date range — try adjusting the kickoff date.");
      }
    } catch (e) {
      setScheduleError("Couldn't reach the schedule service: " + e.message);
    }
    setScheduleLoading(false);
  };

  const addAllScheduleGames = async () => {
    await Promise.all(
      scheduleGames.map((g) =>
        addGame({ home: g.home, away: g.away, game_date: g.game_date })
      )
    );
    setScheduleGames([]);
  };

  const fetchResultsAndOdds = async () => {
    setResultsLoading(true);
    setResultsError("");
    setResultsMessage("");
    try {
      // This week's games are already loaded -- use their real dates directly
      // rather than extrapolating from Week 1's earliest game (fragile if
      // Week 1 ever has an early one-off game, e.g. a Wednesday opener).
      const knownDates = games.map((g) => g.game_date).filter(Boolean).sort();
      let startStr;
      let days;
      if (knownDates.length > 0) {
        const [y, m, d] = knownDates[0].split("-").map(Number);
        const [ey, em, ed] = knownDates[knownDates.length - 1].split("-").map(Number);
        const start = new Date(Date.UTC(y, m - 1, d));
        const end = new Date(Date.UTC(ey, em - 1, ed));
        start.setUTCDate(start.getUTCDate() - 1); // small buffer on both ends
        end.setUTCDate(end.getUTCDate() + 1);
        startStr = start.toISOString().slice(0, 10);
        days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      } else {
        startStr = await getWeekStartDate(editWeek);
        days = 8;
      }
      const res = await fetch(`/api/schedule?start=${startStr}&days=${days}`);
      const json = await res.json();
      if (json.error) {
        setResultsError(json.error);
        setResultsLoading(false);
        return;
      }

      let winnersSet = 0;
      let spreadsUpdated = 0;

      for (const g of games) {
        const match = (json.games || []).find(
          (m) => m.home === g.home && m.away === g.away
        );
        if (!match) continue;

        const patch = {};
        if (!g.winner && match.completed && match.winner) {
          patch.winner = match.winner;
        }
        if (match.spread != null && Number(match.spread) !== Number(g.spread)) {
          patch.spread = match.spread;
        }
        if (Object.keys(patch).length > 0) {
          await updateGame(g.id, patch);
          if (patch.winner) winnersSet += 1;
          if (patch.spread != null) spreadsUpdated += 1;
        }
      }

      setResultsMessage(
        winnersSet === 0 && spreadsUpdated === 0
          ? "No updates — either nothing's changed, or ESPN doesn't have this week's lines/results posted yet."
          : `Updated ${spreadsUpdated} spread(s) and filled in ${winnersSet} winner(s).`
      );
    } catch (e) {
      setResultsError("Couldn't reach the schedule service: " + e.message);
    }
    setResultsLoading(false);
  };

  const updateGame = async (id, patch) => {
    const { error: updErr } = await supabase.from("games").update(patch).eq("id", id);
    if (updErr) { setError(updErr.message); return; }
    setGames((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const removeGame = async (id) => {
    await supabase.from("games").delete().eq("id", id);
    setGames((prev) => prev.filter((g) => g.id !== id));
  };

  const toggleFinal = async () => {
    const next = !weekFinal;
    const { error: upErr } = await supabase
      .from("weeks")
      .upsert({ week: editWeek, final: next }, { onConflict: "week" });
    if (upErr) { setError(upErr.message); return; }
    setWeekFinal(next);
  };

  const lockInMissingPicks = async () => {
    setLockInBusy(true);
    setLockInResult(null);
    setLockInError("");
    try {
      const { data: allEntries } = await supabase.from("entries").select("*");
      const { data: allGames } = await supabase.from("games").select("*");
      const { data: allWeeks } = await supabase.from("weeks").select("*");
      const { data: allPicks } = await supabase.from("picks").select("*");

      const finalByWeek = {};
      const lockSettingsByWeek = {};
      (allWeeks || []).forEach((w) => {
        finalByWeek[w.week] = w.final;
        lockSettingsByWeek[w.week] = { day: w.weekend_lock_day, time: w.weekend_lock_time };
      });
      const gamesByWeek = {};
      (allGames || []).forEach((g) => {
        const settings = lockSettingsByWeek[g.week] || {};
        const enriched = { ...g, weekend_lock_day: settings.day, weekend_lock_time: settings.time };
        gamesByWeek[g.week] = gamesByWeek[g.week] || [];
        gamesByWeek[g.week].push(enriched);
      });

      if (!weekFullyLocked(editWeek, gamesByWeek)) {
        const proceed = confirm(
          `Not every game in week ${editWeek} has passed its lock time yet. Lock in missing picks anyway?`
        );
        if (!proceed) { setLockInBusy(false); return; }
      }

      const picksByEntry = {};
      (allPicks || []).forEach((p) => {
        picksByEntry[p.entry_id] = picksByEntry[p.entry_id] || {};
        picksByEntry[p.entry_id][p.week] = { team: p.team, auto: p.auto_assigned };
      });

      const priorWeekNums = Object.keys(gamesByWeek)
        .map(Number)
        .filter((w) => w < editWeek)
        .sort((a, b) => a - b);

      let lockedCount = 0;
      const skipped = [];

      for (const entry of allEntries || []) {
        const entryPicks = picksByEntry[entry.id] || {};
        if (entryPicks[editWeek]?.team) continue; // already has a real pick this week

        const status = computeStatus(entryPicks, gamesByWeek, finalByWeek);
        if (status.eliminated && status.eliminatedWeek < editWeek) continue; // already out before this week

        let lastPick = null;
        for (const w of priorWeekNums) {
          const d = status.detail[w];
          if (d && d.pick) lastPick = d.pick;
        }

        const fallback = computeFallbackPick(editWeek, lastPick, gamesByWeek);
        if (!fallback) {
          skipped.push(entry.label);
          continue;
        }

        const { error: insErr } = await supabase
          .from("picks")
          .upsert(
            { entry_id: entry.id, week: editWeek, team: fallback.team, auto_assigned: true },
            { onConflict: "entry_id,week" }
          );
        if (!insErr) lockedCount += 1;
      }

      setLockInResult({ lockedCount, skipped });
      load();
    } catch (e) {
      setLockInError(e.message);
    }
    setLockInBusy(false);
  };

  const resetPool = async () => {
    if (!confirm("This deletes ALL games, weeks, entries, and picks. This cannot be undone. Continue?")) return;
    await supabase.from("picks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("games").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("weeks").delete().neq("week", -1);
    await supabase.from("pool_settings").update({ current_week: 1 }).eq("id", 1);
    load();
  };

  return (
    <div className="grid gap-8">
      {error && <p className="text-rust text-sm">{error}</p>}

      <div>
        <div className="text-sm font-bold mb-2">Pool name</div>
        <div className="flex items-center gap-2">
          <input
            className="max-w-xs"
            value={poolNameInput}
            onChange={(e) => setPoolNameInput(e.target.value)}
          />
          <button className="btn-primary" onClick={savePoolName}>Save</button>
          {poolNameSaved && <span className="text-leaf text-xs">Saved</span>}
        </div>
      </div>

      <div>
        <div className="text-sm font-bold mb-2">Current week (what participants can pick)</div>
        <div className="flex items-center gap-3">
          <span
            className="font-black text-lg px-3 py-1 rounded"
            style={{ background: "rgba(242,102,26,0.15)", color: "#F2661A" }}
          >
            Week {computeAutoCurrentWeek(allGamesByWeek)}
          </span>
          <span className="text-xs text-chalk/50">{ruleLabel(computeAutoCurrentWeek(allGamesByWeek))}</span>
        </div>
        <p className="text-xs text-chalk/50 mt-2">
          This is automatic now, based on today's date — no need to set it manually. It advances every Tuesday to
          the next week, as long as that week's games have already been loaded (it won't jump ahead to an empty
          week). Participants can pick this week or any later loaded week — never a past week, even an unfinished
          one.
        </p>
      </div>

      <div className="border border-turfline rounded-lg p-4">
        <label className="text-sm font-bold flex items-center gap-2">
          <input type="checkbox" checked={!!settings.signups_locked} onChange={toggleSignupsLocked} />
          Lock roster (no new sign-ups, no new entries)
        </label>
        {lockSaved && <p className="text-leaf text-xs mt-1">Saved.</p>}
        {lockError && <p className="text-rust text-xs mt-1">{lockError}</p>}
        <p className="text-xs text-chalk/50 mt-2">
          When checked, the sign-up page shows a "closed" message instead of the form, and existing users can no
          longer create additional entries. This only hides the in-app form/button — it doesn't stop someone from
          creating an account through Supabase's own API directly. For a real hard lock once the season starts,
          also turn off "Allow new users to sign up" under Supabase's Authentication settings.
        </p>
      </div>

      <div className="border border-turfline rounded-lg p-4">
        <div className="text-sm font-bold mb-1">Sync schedule</div>
        <p className="text-xs text-chalk/50 mb-3">
          Pulls matchups (not spreads) for the week selected below. Review before adding — you can skip games you don't want.
        </p>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <label className="text-xs flex items-center gap-2">
            Week 1 kickoff date (only used until Week 1 has games loaded)
            <input
              type="date"
              value={kickoffDate}
              onChange={(e) => setKickoffDate(e.target.value)}
            />
          </label>
          <button className="btn-ghost" onClick={fetchSchedule} disabled={scheduleLoading}>
            {scheduleLoading ? "Fetching…" : `Fetch week ${editWeek} matchups`}
          </button>
        </div>
        {scheduleError && <p className="text-rust text-sm mb-2">{scheduleError}</p>}
        {scheduleGames.length > 0 && (
          <div className="grid gap-2">
            <button className="btn-primary w-fit mb-2" onClick={addAllScheduleGames}>
              Add all {scheduleGames.length} games to week {editWeek}
            </button>
            {scheduleGames.map((g, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap text-sm border-t border-turfline pt-2">
                <span className="flex-1 min-w-[220px]">
                  {g.away} @ {g.home}
                  {g.date && <span className="text-chalk/40 text-xs"> — {new Date(g.date).toLocaleDateString()}</span>}
                </span>
                <button className="btn-ghost" onClick={() => addGame({ home: g.home, away: g.away, game_date: g.game_date })}>
                  Add to week {editWeek}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center flex-wrap gap-3 mb-2">
          <div className="text-sm font-bold">Edit games for week</div>
          <div className="flex items-center gap-3">
            <select value={editWeek} onChange={(e) => setEditWeek(Number(e.target.value))} className="w-36">
              {Array.from({ length: 22 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>Week {n}</option>
              ))}
            </select>
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={weekFinal} onChange={toggleFinal} />
              Mark week final
            </label>
          </div>
        </div>
        <p className="text-xs text-chalk/50 mb-3">
          {ruleLabel(editWeek)} Marking a week final locks in results: a losing pick eliminates an entry, and a missing pick first tries last week's team (if it's still an option), then the biggest favorite this week — only eliminating if neither is available.
        </p>

        <div className="border border-turfline rounded-lg p-4 mb-4">
          <div className="text-sm font-bold mb-1">Weekend pick deadline for week {editWeek}</div>
          <p className="text-xs text-chalk/50 mb-3">
            When Sat/Sun/Mon games lock, all together. Wed/Thu/Fri games always lock 6:00 PM Central that same day, regardless of this setting.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={weekendLockDay}
              onChange={(e) => saveLockSettings(e.target.value, weekendLockTime)}
              className="w-36"
            >
              <option value="saturday">Saturday</option>
              <option value="sunday">Sunday</option>
            </select>
            {(() => {
              const [h, m] = weekendLockTime.split(":").map(Number);
              const hour12 = h % 12 === 0 ? 12 : h % 12;
              const ampm = h >= 12 ? "PM" : "AM";
              const updateTime = (newHour12, newMinute, newAmpm) => {
                let hour24 = newHour12 % 12;
                if (newAmpm === "PM") hour24 += 12;
                const hh = String(hour24).padStart(2, "0");
                const mm = String(newMinute).padStart(2, "0");
                saveLockSettings(weekendLockDay, `${hh}:${mm}`);
              };
              return (
                <>
                  <select value={hour12} onChange={(e) => updateTime(Number(e.target.value), m, ampm)} className="w-20">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <select value={String(m).padStart(2, "0")} onChange={(e) => updateTime(hour12, Number(e.target.value), ampm)} className="w-20">
                    {["00", "15", "30", "45"].map((mm) => (
                      <option key={mm} value={mm}>:{mm}</option>
                    ))}
                  </select>
                  <select value={ampm} onChange={(e) => updateTime(hour12, m, e.target.value)} className="w-20">
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </>
              );
            })()}
            <span className="text-xs text-chalk/50">Central time</span>
            {lockSettingsSaved && <span className="text-leaf text-xs">Saved</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap mb-4">
          <button className="btn-ghost" onClick={fetchResultsAndOdds} disabled={resultsLoading || games.length === 0}>
            {resultsLoading ? "Checking…" : "Sync results & odds from ESPN"}
          </button>
          <span className="text-xs text-chalk/50">
            Fills in winners for finished games and refreshes spreads for existing games in this week — only for games already added below.
          </span>
        </div>
        {resultsError && <p className="text-rust text-sm mb-3">{resultsError}</p>}
        {resultsMessage && <p className="text-leaf text-sm mb-3">{resultsMessage}</p>}

        <div className="border border-turfline rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button className="btn-primary" onClick={lockInMissingPicks} disabled={lockInBusy}>
              {lockInBusy ? "Locking in…" : `Lock in missing picks for week ${editWeek}`}
            </button>
          </div>
          <p className="text-xs text-chalk/50 mt-2">
            Click this once, right after the pick deadline has passed for the week (and before any games are
            played) — it writes real, tagged "auto" picks into the database for anyone who didn't submit one, using
            the same carried-over-team / biggest-favorite rule. Doing it at the deadline, before results exist,
            gives you a clear record it wasn't assigned after the fact. Marking the week final later (once you
            know winners) then just grades whatever's already there.
          </p>
          {lockInError && <p className="text-rust text-sm mt-2">{lockInError}</p>}
          {lockInResult && (
            <p className="text-leaf text-sm mt-2">
              Locked in {lockInResult.lockedCount} pick(s) for week {editWeek}.
              {lockInResult.skipped.length > 0 &&
                ` Couldn't find a fallback for: ${lockInResult.skipped.join(", ")} (no favorites set on eligible games).`}
            </p>
          )}
        </div>

        {loadingData ? (
          <p className="text-chalk/60 text-sm">Loading games…</p>
        ) : (
          <div className="grid gap-2">
            {games.map((g) => (
              <div key={g.id} className="border border-turfline rounded-lg p-3 flex gap-2 flex-wrap items-center">
                <select value={g.away} onChange={(e) => updateGame(g.id, { away: e.target.value })} className="w-52">
                  {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-xs text-chalk/50">@</span>
                <select value={g.home} onChange={(e) => updateGame(g.id, { home: e.target.value })} className="w-52">
                  {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  type="number"
                  step="0.5"
                  value={g.spread}
                  onChange={(e) => updateGame(g.id, { spread: Number(e.target.value) })}
                  className="w-24"
                  title="Spread relative to the home team: negative = home favored, positive = home underdog (e.g. -3.5 or 7)"
                />
                <span className="text-xs text-chalk/50 w-44 flex-shrink-0">{spreadLabel(g)}</span>
                <label className="text-xs flex items-center gap-1">
                  Game date
                  <input
                    type="date"
                    value={g.game_date || ""}
                    onChange={(e) => updateGame(g.id, { game_date: e.target.value || null })}
                  />
                </label>
                <select
                  value={g.winner || ""}
                  onChange={(e) => updateGame(g.id, { winner: e.target.value || null })}
                  className="w-44"
                >
                  <option value="">Winner: TBD</option>
                  <option value={g.away}>{g.away}</option>
                  <option value={g.home}>{g.home}</option>
                </select>
                <button className="btn-ghost text-rust border-rust" onClick={() => removeGame(g.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary mt-3" onClick={() => addGame()}>+ Add game</button>
      </div>

      <div>
        <button className="btn-ghost text-rust border-rust" onClick={resetPool}>Reset entire pool</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Roster & Payments
// ------------------------------------------------------------------
function RosterTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savedIds, setSavedIds] = useState({});
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    (async () => {
      const { data: profiles } = await supabase.from("profiles").select("*").order("display_name");
      const { data: entries } = await supabase.from("entries").select("id,user_id");
      const countByUser = {};
      (entries || []).forEach((e) => { countByUser[e.user_id] = (countByUser[e.user_id] || 0) + 1; });
      setRows((profiles || []).map((p) => ({ ...p, entryCount: countByUser[p.id] || 0 })));
      setLoading(false);
    })();
  }, []);

  const savePayment = async (id, value) => {
    const { error } = await supabase.from("profiles").update({ payment_note: value }).eq("id", id);
    if (error) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, payment_note: value } : r)));
    setSavedIds((s) => ({ ...s, [id]: true }));
    setTimeout(() => setSavedIds((s) => ({ ...s, [id]: false })), 1500);
  };

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    return !q || (r.display_name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "name") {
      cmp = (a.display_name || "").localeCompare(b.display_name || "");
    } else if (sortKey === "entries") {
      cmp = a.entryCount - b.entryCount;
    } else if (sortKey === "payment") {
      cmp = (a.payment_note || "").localeCompare(b.payment_note || "");
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const arrow = (key) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const exportCSV = () => {
    const escape = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const headers = ["Name", "Email", "# Entries", "How they paid"];
    const csvRows = [headers.join(",")];
    sorted.forEach((r) => {
      csvRows.push([escape(r.display_name), escape(r.email), r.entryCount, escape(r.payment_note)].join(","));
    });
    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `roster-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-chalk/60 text-sm">Loading roster…</p>;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <button className="btn-ghost" onClick={exportCSV}>Export to CSV</button>
      </div>
      <p className="text-xs text-chalk/50 mb-3">{rows.length} people signed up total.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-chalk/50">
              <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                Name{arrow("name")}
              </th>
              <th className="py-2 px-2 cursor-pointer select-none w-28" onClick={() => toggleSort("entries")}>
                # Entries{arrow("entries")}
              </th>
              <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort("payment")}>
                How they paid{arrow("payment")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-t border-turfline">
                <td className="py-2 px-2">
                  <div className="font-bold">{r.display_name || "(no name)"}</div>
                  <div className="text-xs text-chalk/50">{r.email}</div>
                </td>
                <td className="py-2 px-2">{r.entryCount}</td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="How they paid (e.g. Venmo, cash)"
                      defaultValue={r.payment_note || ""}
                      onBlur={(e) => savePayment(r.id, e.target.value)}
                      className="flex-1 min-w-[200px]"
                    />
                    {savedIds[r.id] && <span className="text-leaf text-xs flex-shrink-0">Saved</span>}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-chalk/50">No matches.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Manage Picks (set/change a pick on behalf of any entry)
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Email (blast everyone, or remind whoever hasn't picked yet)
// ------------------------------------------------------------------
function EmailTab() {
  const [mode, setMode] = useState("remind"); // "remind" | "everyone"
  const [week, setWeek] = useState(1);
  const [missing, setMissing] = useState([]); // [{label, email}]
  const [allEmails, setAllEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: gameRows } = await supabase.from("games").select("*");
      const gbw = {};
      (gameRows || []).forEach((g) => { gbw[g.week] = gbw[g.week] || []; gbw[g.week].push(g); });
      setWeek(computeAutoCurrentWeek(gbw));
      const { data: profiles } = await supabase.from("profiles").select("email");
      setAllEmails(Array.from(new Set((profiles || []).map((p) => p.email).filter(Boolean))));
    })();
  }, []);

  const loadMissing = useCallback(async (wk) => {
    setLoading(true);
    const { data: entries } = await supabase.from("entries").select("*");
    const { data: gameRows } = await supabase.from("games").select("*");
    const { data: weekRows } = await supabase.from("weeks").select("*");
    const { data: pickRows } = await supabase.from("picks").select("*");

    const finalByWeek = {};
    const lockSettingsByWeek = {};
    (weekRows || []).forEach((w) => {
      finalByWeek[w.week] = w.final;
      lockSettingsByWeek[w.week] = { day: w.weekend_lock_day, time: w.weekend_lock_time };
    });
    const gamesByWeek = {};
    (gameRows || []).forEach((g) => {
      const settings = lockSettingsByWeek[g.week] || {};
      const enriched = { ...g, weekend_lock_day: settings.day, weekend_lock_time: settings.time };
      gamesByWeek[g.week] = gamesByWeek[g.week] || [];
      gamesByWeek[g.week].push(enriched);
    });
    const picksByEntry = {};
    (pickRows || []).forEach((p) => {
      picksByEntry[p.entry_id] = picksByEntry[p.entry_id] || {};
      picksByEntry[p.entry_id][p.week] = { team: p.team, auto: p.auto_assigned };
    });

    const list = [];
    (entries || []).forEach((e) => {
      const status = computeStatus(picksByEntry[e.id] || {}, gamesByWeek, finalByWeek);
      const alreadyEliminated = status.eliminated && status.eliminatedWeek < wk;
      const hasPick = !!(picksByEntry[e.id] && picksByEntry[e.id][wk]);
      if (!alreadyEliminated && !hasPick) {
        list.push({ label: e.label, email: e.email });
      }
    });
    setMissing(list);
    setLoading(false);
  }, []);

  useEffect(() => { loadMissing(week); }, [week, loadMissing]);

  useEffect(() => {
    if (mode === "remind") {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      setSubject(`Reminder: Week ${week} pick still needed`);
      setMessage(
        `Hey — just a reminder to get your Week ${week} survivor pick in.${siteUrl ? ` Pick here: ${siteUrl}/dashboard` : " Head to the site when you get a chance."}\n\nThanks!`
      );
    } else {
      setSubject("");
      setMessage("");
    }
  }, [mode, week]);

  const missingEmails = Array.from(new Set(missing.map((m) => m.email).filter(Boolean)));

  const send = async () => {
    setSending(true);
    setResult(null);
    setError("");
    const recipients = mode === "remind" ? missingEmails : allEmails;
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, recipients }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setResult(json);
    } catch (e) {
      setError(e.message);
    }
    setSending(false);
  };

  return (
    <div className="grid gap-5 max-w-2xl">
      <p className="text-xs text-chalk/50">
        Sends from your own Gmail account. Requires GMAIL_USER and GMAIL_APP_PASSWORD to be set
        (see README) — until then, sending will show a config error below.
      </p>

      <div className="flex gap-2">
        <button
          className={mode === "remind" ? "btn-primary" : "btn-ghost"}
          onClick={() => { setMode("remind"); setResult(null); setError(""); }}
        >
          Remind missing picks
        </button>
        <button
          className={mode === "everyone" ? "btn-primary" : "btn-ghost"}
          onClick={() => { setMode("everyone"); setResult(null); setError(""); }}
        >
          Email everyone
        </button>
      </div>

      {mode === "remind" && (
        <div>
          <label className="text-xs flex items-center gap-2 mb-2">
            Week
            <select value={week} onChange={(e) => setWeek(Number(e.target.value))} className="w-32">
              {Array.from({ length: 22 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>Week {n}</option>
              ))}
            </select>
          </label>
          {loading ? (
            <p className="text-chalk/60 text-sm">Checking who's missing a pick…</p>
          ) : (
            <p className="text-sm text-chalk/70">
              {missingEmails.length} email{missingEmails.length === 1 ? "" : "s"} missing a Week {week} pick
              ({missing.length} entr{missing.length === 1 ? "y" : "ies"}).
            </p>
          )}
        </div>
      )}

      {mode === "everyone" && (
        <p className="text-sm text-chalk/70">{allEmails.length} people signed up total.</p>
      )}

      <div>
        <div className="text-xs text-chalk/50 mb-1">Subject</div>
        <input className="w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <div className="text-xs text-chalk/50 mb-1">Message</div>
        <textarea
          className="w-full min-h-[140px]"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <button
        className="btn-primary w-fit"
        disabled={sending || (mode === "remind" ? missingEmails.length === 0 : allEmails.length === 0)}
        onClick={send}
      >
        {sending ? "Sending…" : `Send to ${mode === "remind" ? missingEmails.length : allEmails.length} recipient${(mode === "remind" ? missingEmails.length : allEmails.length) === 1 ? "" : "s"}`}
      </button>

      {error && <p className="text-rust text-sm">{error}</p>}
      {result && (
        <p className="text-leaf text-sm">
          Sent to {result.sent} of {result.total} recipients across {result.batchCount} batch{result.batchCount === 1 ? "" : "es"}.
        </p>
      )}
      {result?.errors?.length > 0 && (
        <p className="text-rust text-sm">Error(s): {result.errors.join("; ")}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Manage Picks (set/change a pick on behalf of any entry)
// ------------------------------------------------------------------
function ManagePicksTab() {
  const [week, setWeek] = useState(1);
  const [entries, setEntries] = useState([]);
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState({}); // entry_id -> { team, auto }
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState({});
  const [statusByEntry, setStatusByEntry] = useState({}); // entry_id -> computeStatus result
  const [onlyAlive, setOnlyAlive] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: gameRows } = await supabase.from("games").select("*");
      const gbw = {};
      (gameRows || []).forEach((g) => { gbw[g.week] = gbw[g.week] || []; gbw[g.week].push(g); });
      setWeek(computeAutoCurrentWeek(gbw));
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: entryRows } = await supabase.from("entries").select("*").order("email");
    setEntries(entryRows || []);

    const { data: weekRow } = await supabase.from("weeks").select("*").eq("week", week).maybeSingle();
    const lockDay = weekRow?.weekend_lock_day || "sunday";
    const lockTime = weekRow?.weekend_lock_time || "10:00";

    const { data: gameRows } = await supabase.from("games").select("*").eq("week", week);
    const enrichedGames = (gameRows || []).map((g) => ({ ...g, weekend_lock_day: lockDay, weekend_lock_time: lockTime }));
    setGames(enrichedGames);

    const ids = (entryRows || []).map((e) => e.id);
    if (ids.length > 0) {
      const { data: pickRows } = await supabase.from("picks").select("*").eq("week", week).in("entry_id", ids);
      const p = {};
      (pickRows || []).forEach((pk) => { p[pk.entry_id] = { team: pk.team, auto: pk.auto_assigned }; });
      setPicks(p);
    } else {
      setPicks({});
    }

    // Full-season data, needed to tell alive entries apart from ones already
    // eliminated in an earlier week -- both can show "no pick" for the
    // current week, so this is the only way to tell them apart.
    const { data: allGameRows } = await supabase.from("games").select("*");
    const { data: allWeekRows } = await supabase.from("weeks").select("*");
    const { data: allPickRows } = await supabase.from("picks").select("*");

    const finalByWeek = {};
    const lockSettingsByWeek = {};
    (allWeekRows || []).forEach((w) => {
      finalByWeek[w.week] = w.final;
      lockSettingsByWeek[w.week] = { day: w.weekend_lock_day, time: w.weekend_lock_time };
    });
    const gamesByWeek = {};
    (allGameRows || []).forEach((g) => {
      const settings = lockSettingsByWeek[g.week] || {};
      const enriched = { ...g, weekend_lock_day: settings.day, weekend_lock_time: settings.time };
      gamesByWeek[g.week] = gamesByWeek[g.week] || [];
      gamesByWeek[g.week].push(enriched);
    });
    const picksByEntry = {};
    (allPickRows || []).forEach((p) => {
      picksByEntry[p.entry_id] = picksByEntry[p.entry_id] || {};
      picksByEntry[p.entry_id][p.week] = { team: p.team, auto: p.auto_assigned };
    });
    const statuses = {};
    (entryRows || []).forEach((e) => {
      statuses[e.id] = computeStatus(picksByEntry[e.id] || {}, gamesByWeek, finalByWeek);
    });
    setStatusByEntry(statuses);

    setLoading(false);
  }, [week]);

  useEffect(() => { load(); }, [load]);

  const teamOptions = Array.from(new Set(games.flatMap((g) => [g.away, g.home])));

  const setPickFor = async (entryId, team) => {
    if (!team) {
      await supabase.from("picks").delete().eq("entry_id", entryId).eq("week", week);
      setPicks((p) => { const next = { ...p }; delete next[entryId]; return next; });
    } else {
      await supabase.from("picks").upsert({ entry_id: entryId, week, team, auto_assigned: false }, { onConflict: "entry_id,week" });
      setPicks((p) => ({ ...p, [entryId]: { team, auto: false } }));
    }
    setSavedIds((s) => ({ ...s, [entryId]: true }));
    setTimeout(() => setSavedIds((s) => ({ ...s, [entryId]: false })), 1500);
  };

  const deleteEntry = async (entry) => {
    const confirmed = confirm(
      `Delete "${entry.label}" (${entry.email})? This removes the entry and all of its picks for every week — this can't be undone.`
    );
    if (!confirmed) return;
    const { error: delErr } = await supabase.from("entries").delete().eq("id", entry.id);
    if (delErr) {
      alert("Couldn't delete: " + delErr.message);
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setPicks((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
  };

  const filtered = entries.filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || (e.label || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (onlyAlive) {
      const status = statusByEntry[e.id];
      if (status?.eliminated) return false;
    }
    return true;
  });

  return (
    <div>
      <p className="text-xs text-chalk/50 mb-3">
        Sets a pick directly, bypassing normal lock/eligibility checks — use this for picks called or texted in after someone couldn't get to the site in time.
        Existing picks stay hidden here too, even from you, until that specific game locks — you can still set a new pick for someone without seeing what's already there.
      </p>
      <div className="flex gap-3 flex-wrap items-center mb-4">
        <label className="text-xs flex items-center gap-2">
          <input type="checkbox" checked={onlyAlive} onChange={(e) => setOnlyAlive(e.target.checked)} />
          Only show entries still alive
        </label>
        <label className="text-xs flex items-center gap-2">
          Week
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))} className="w-32">
            {Array.from({ length: 22 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>Week {n}</option>
            ))}
          </select>
        </label>
        <input
          placeholder="Search by entry or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />
      </div>

      {games.length === 0 && <p className="text-chalk/50 text-sm mb-3">No games entered for week {week} yet.</p>}

      {loading ? (
        <p className="text-chalk/60 text-sm">Loading…</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map((entry) => {
            const pickInfo = picks[entry.id];
            const pickedTeam = pickInfo?.team || null;
            const game = pickedTeam ? games.find((g) => g.home === pickedTeam || g.away === pickedTeam) : null;
            const revealed = !pickedTeam || !game || isLocked(game);
            const displayValue = revealed ? pickedTeam || "" : "";

            return (
              <div key={entry.id} className="border border-turfline rounded-lg p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-sm flex items-center gap-2">
                    {entry.label}
                    {statusByEntry[entry.id]?.eliminated ? (
                      <span className="pill pill-red">Eliminated wk {statusByEntry[entry.id].eliminatedWeek}</span>
                    ) : (
                      <span className="pill pill-green">Alive</span>
                    )}
                  </div>
                  <div className="text-xs text-chalk/50">{entry.email}</div>
                </div>
                <select
                  value={displayValue}
                  onChange={(e) => setPickFor(entry.id, e.target.value)}
                  className="w-56"
                >
                  <option value="">{pickedTeam && !revealed ? "— Hidden until game locks —" : "— No pick —"}</option>
                  {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {pickedTeam && !revealed && (
                  <span className="text-chalk/50 text-xs italic" title="This pick exists but stays hidden, even from admin, until that specific game locks.">
                    Hidden until locked
                  </span>
                )}
                {revealed && pickInfo?.auto && <span className="text-amber text-xs" title="Set by the lock-in tool, not the participant">(auto)</span>}
                {savedIds[entry.id] && <span className="text-leaf text-xs">Saved</span>}
                <button
                  className="btn-ghost text-rust border-rust"
                  onClick={() => deleteEntry(entry)}
                  title="Removes this entry and all of its picks, every week"
                >
                  Delete entry
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-chalk/50 text-sm">No matches.</p>}
        </div>
      )}
    </div>
  );
}
