"use client";
import { useEffect, useState } from "react";
import { supabase, fetchAllRows } from "../../lib/supabaseClient";
import { computeStatus } from "../../lib/poolLogic";

const ZERO_ID = "00000000-0000-0000-0000-000000000000";
const CONFIRM_WORD = "NEW SEASON";
const MISSING_SQL = "Run supabase/migration_add_season_over.sql in the Supabase SQL editor first.";

// Entries still alive, worked out the same way as the Weekly Summary (public
// data only), so the "End season" message can name the winner(s).
async function loadSurvivors() {
  const entries = await fetchAllRows("public_entries", "*", "id");
  const games = await fetchAllRows("games", "*", "created_at");
  const weeks = await fetchAllRows("weeks", "*", "week");
  const picks = await fetchAllRows("revealed_picks", "*", "id");
  const finalByWeek = {};
  const lock = {};
  (weeks || []).forEach((w) => {
    finalByWeek[w.week] = w.final;
    lock[w.week] = { day: w.weekend_lock_day, time: w.weekend_lock_time };
  });
  const gamesByWeek = {};
  (games || []).forEach((g) => {
    (gamesByWeek[g.week] = gamesByWeek[g.week] || []).push({
      ...g, weekend_lock_day: lock[g.week]?.day, weekend_lock_time: lock[g.week]?.time,
    });
  });
  const picksByEntry = {};
  (picks || []).forEach((p) => {
    (picksByEntry[p.entry_id] = picksByEntry[p.entry_id] || {})[p.week] = { team: p.team, auto: p.auto_assigned };
  });
  return (entries || [])
    .filter((e) => !computeStatus(picksByEntry[e.id] || {}, gamesByWeek, finalByWeek).eliminated)
    .map((e) => e.label);
}

function defaultMessage(survivors) {
  const year = new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear();
  if (survivors.length === 1) return `The ${year} season is over. Congratulations to our winner, ${survivors[0]}!`;
  if (survivors.length > 1 && survivors.length <= 5)
    return `The ${year} season is over. Congratulations to our winners: ${survivors.join(", ")}!`;
  return `The ${year} season is over. Thanks for playing!`;
}

export default function SeasonPanel({ settings, onChanged }) {
  const seasonOver = !!settings.season_over;
  const [survivors, setSurvivors] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const [confirmText, setConfirmText] = useState("");
  const [clearPayments, setClearPayments] = useState(true);
  const [clearNotices, setClearNotices] = useState(true);
  const [resetLog, setResetLog] = useState([]);

  useEffect(() => {
    if (seasonOver) {
      setMessage(settings.season_over_message || "");
      return;
    }
    loadSurvivors()
      .then((s) => { setSurvivors(s); setMessage(defaultMessage(s)); })
      .catch(() => setSurvivors([]));
  }, [seasonOver, settings.season_over_message]);

  const setSeasonOver = async (over) => {
    setBusy(true); setError(""); setDone("");
    const update = over
      ? { season_over: true, season_over_message: message.trim() || null, signups_locked: true }
      : { season_over: false };
    const { error: err } = await supabase.from("pool_settings").update(update).eq("id", 1);
    setBusy(false);
    if (err) {
      setError(/season_over/.test(err.message) ? MISSING_SQL : err.message);
      return;
    }
    setDone(over ? "Season ended." : "Season reopened.");
    onChanged();
  };

  const saveMessage = async () => {
    setBusy(true); setError(""); setDone("");
    const { error: err } = await supabase.from("pool_settings").update({ season_over_message: message.trim() || null }).eq("id", 1);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone("Message saved.");
    onChanged();
  };

  // Clears last season's games, weeks, entries and picks. Each step is
  // checked, and the end result is counted, so nothing fails silently.
  const startNewSeason = async () => {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy(true); setError(""); setDone("");
    const log = [];
    const step = async (label, run) => {
      const { error: err } = await run();
      log.push({ label, ok: !err, note: err?.message });
      setResetLog([...log]);
      return !err;
    };

    // Deleting entries also deletes their picks and pick history.
    let ok = await step("Delete entries and their picks", () => supabase.from("entries").delete().neq("id", ZERO_ID));
    ok = ok && (await step("Delete games", () => supabase.from("games").delete().neq("id", ZERO_ID)));
    ok = ok && (await step("Delete weeks", () => supabase.from("weeks").delete().neq("week", -1)));

    if (ok) {
      // Turn the season switch back off. Falls back to just the week if the
      // season columns don't exist yet.
      let res = await supabase.from("pool_settings")
        .update({ current_week: 1, season_over: false, season_over_message: null }).eq("id", 1);
      if (res.error && /season_over/.test(res.error.message)) {
        res = await supabase.from("pool_settings").update({ current_week: 1 }).eq("id", 1);
      }
      log.push({ label: "Reset season settings", ok: !res.error, note: res.error?.message });
      if (clearPayments) {
        await step("Clear payment notes", () => supabase.from("profiles").update({ payment_note: null }).not("payment_note", "is", null));
      }
      if (clearNotices) {
        await step("Delete old announcements", () => supabase.from("notices").delete().neq("id", ZERO_ID));
      }
    }

    // Count what's left. Deletes blocked by permissions don't return an
    // error, so this is the real check.
    const count = async (table) => {
      const { count: n, error: err } = await supabase.from(table).select("*", { count: "exact", head: true });
      return err ? null : n;
    };
    const left = { entries: await count("public_entries"), games: await count("games"), weeks: await count("weeks") };
    const leftover = Object.entries(left).filter(([, n]) => n);
    if (leftover.length) {
      log.push({
        label: "Check that everything was cleared",
        ok: false,
        note: `Still there: ${leftover.map(([t, n]) => `${n} ${t}`).join(", ")}.` + (left.weeks ? ` ${MISSING_SQL}` : ""),
      });
    } else {
      log.push({ label: "Check that everything was cleared", ok: true });
    }
    setResetLog([...log]);
    setBusy(false);
    setConfirmText("");
    if (log.every((l) => l.ok)) setDone("New season ready. Load the new schedule, then uncheck \"Lock roster\" to open sign-ups.");
    else setError("Some steps didn't finish. See the list below.");
    onChanged();
  };

  return (
    <div className="grid gap-4">
      <div className="border border-turfline rounded-lg p-4 grid gap-3">
        <div className="text-sm font-bold">End of season</div>
        {seasonOver ? (
          <>
            <p className="text-sm">
              <span className="pill pill-red mr-2">Season over</span>
              Players can't make picks or add entries, reminders are off, and this message shows on My Entries and the Weekly Summary.
            </p>
            <textarea className="w-full" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary" disabled={busy} onClick={saveMessage}>Save message</button>
              <button className="btn-ghost" disabled={busy} onClick={() => setSeasonOver(false)}>Reopen season</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-chalk/50">
              Ending the season stops pick reminders, closes picks and new entries, and puts the message below on
              My Entries and the Weekly Summary. Standings stay up all off-season. You can reopen it if you need to.
            </p>
            <p className="text-sm">
              {survivors === null
                ? "Checking who's still alive…"
                : `Entries still alive: ${survivors.length}${survivors.length && survivors.length <= 5 ? ` (${survivors.join(", ")})` : ""}.`}
              {survivors && survivors.length > 1 && (
                <span className="text-chalk/50"> If the last games are over, grade them first so this shows the real winner.</span>
              )}
            </p>
            <textarea className="w-full" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div>
              <button className="btn-primary" disabled={busy} onClick={() => setSeasonOver(true)}>End season</button>
            </div>
          </>
        )}
        {done && <p className="text-leaf text-xs">{done}</p>}
        {error && <p className="text-rust text-xs">{error}</p>}
      </div>

      <div className="border border-rust/50 rounded-lg p-4 grid gap-3">
        <div className="text-sm font-bold">Start a new season</div>
        <p className="text-xs text-chalk/50">
          Permanently deletes every game, week, entry and pick from this season, including pick history. Accounts,
          the blocked list and the playoff pool aren't touched. Save anything you want to keep (like the season
          recap) before you do this.
        </p>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={clearPayments} onChange={(e) => setClearPayments(e.target.checked)} />
          Also clear everyone's payment notes
        </label>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={clearNotices} onChange={(e) => setClearNotices(e.target.checked)} />
          Also delete this season's announcements
        </label>
        <label className="text-xs text-chalk/60">
          Type {CONFIRM_WORD} to confirm
          <input className="w-full mt-1 max-w-xs block" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </label>
        <div>
          <button
            className="btn-ghost text-rust border-rust"
            disabled={busy || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
            onClick={startNewSeason}
          >
            {busy ? "Working…" : "Start new season"}
          </button>
        </div>
        {resetLog.length > 0 && (
          <ul className="text-xs grid gap-1">
            {resetLog.map((l, i) => (
              <li key={i} className={l.ok ? "text-leaf" : "text-rust"}>
                {l.ok ? "✓" : "✗"} {l.label}{l.note ? `: ${l.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
