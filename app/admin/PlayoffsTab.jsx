"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase, fetchAllRows } from "../../lib/supabaseClient";
import { wallTimeToUTC } from "../../lib/poolLogic";
import { TEAMS } from "../../lib/teams";
import {
  ROUNDS,
  roundName,
  halfPointSpread,
  halfPointTotal,
  pickLabel,
  matchupLabel,
  gameStarted,
  linesLockTime,
  linesLocked,
  roundLockTime,
  formatCentral,
  autoPickFor,
  currentRound,
  computePlayoffStatus,
  groupGamesByRound,
  picksFromRevealed,
} from "../../lib/playoffLogic";

// Kickoff <-> the "YYYY-MM-DDTHH:MM" a datetime-local input uses, in Central.
function toCentralInput(kickoff) {
  if (!kickoff) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(new Date(kickoff))
    .forEach((p) => (parts[p.type] = p.value));
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

function fromCentralInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return { kickoff: wallTimeToUTC("America/Chicago", y, mo, d, h, mi).toISOString(), game_date: value.slice(0, 10) };
}

export default function PlayoffsTab() {
  const [settings, setSettings] = useState(null);
  const [settingsMissing, setSettingsMissing] = useState(false);
  const [round, setRound] = useState(1);
  const [gamesByRound, setGamesByRound] = useState({});
  const [entries, setEntries] = useState([]);
  const [revealedRows, setRevealedRows] = useState([]);
  const [payments, setPayments] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const [scheduleGames, setScheduleGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editLockedLines, setEditLockedLines] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data: s, error: sErr } = await supabase.from("playoff_settings").select("*").eq("id", 1).maybeSingle();
    if (sErr || !s) {
      setSettingsMissing(true);
      setLoading(false);
      return;
    }
    setSettings(s);
    const gameRows = await fetchAllRows("playoff_games", "*", "id");
    const gbr = groupGamesByRound(gameRows);
    setGamesByRound(gbr);
    setEntries((await fetchAllRows("playoff_entries", "*", "created_at")).sort((a, b) => (a.email || "").localeCompare(b.email || "")));
    setRevealedRows(await fetchAllRows("playoff_revealed_picks", "*", "id"));
    const pay = {};
    (await fetchAllRows("playoff_payments", "*", "user_id")).forEach((p) => { pay[p.user_id] = p.note || ""; });
    setPayments(pay);
    setLoading(false);
    return gbr;
  }, []);

  useEffect(() => {
    load().then((gbr) => { if (gbr) setRound(currentRound(gbr)); });
  }, [load]);

  useEffect(() => { setScheduleGames([]); setMessage(""); setEditLockedLines(false); }, [round]);

  if (loading) return <p className="text-chalk/60 text-sm">Loading…</p>;
  if (settingsMissing) {
    return (
      <p className="text-rust text-sm">
        The playoff tables aren't set up yet. Run supabase/playoffs.sql in Supabase's SQL Editor, then reload this page.
      </p>
    );
  }

  const games = gamesByRound[round] || [];
  const nflWeek = ROUNDS.find((r) => r.round === round).nflWeek;
  const lockAt = linesLockTime(games);
  const linesFrozen = linesLocked(games);
  const auto = autoPickFor(games);

  const saveSetting = async (patch) => {
    setError("");
    const { error: err } = await supabase.from("playoff_settings").update(patch).eq("id", 1);
    if (err) { setError(err.message); return; }
    setSettings((s) => ({ ...s, ...patch }));
  };

  // Applies a change to the loaded games (all rounds), keeping them grouped.
  const changeGames = (fn) => setGamesByRound((prev) => groupGamesByRound(fn(Object.values(prev).flat())));

  const updateGame = async (id, patch) => {
    setError("");
    const { error: err } = await supabase.from("playoff_games").update(patch).eq("id", id);
    if (err) { setError(err.message); return false; }
    changeGames((all) => all.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    return true;
  };

  const insertGames = async (rows) => {
    const { data, error: err } = await supabase.from("playoff_games").insert(rows).select();
    if (err) { setError(err.message); return; }
    changeGames((all) => [...all, ...(data || [])]);
  };

  const fetchSchedule = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/schedule?week=${nflWeek}&season=${settings.season}&playoffs=1`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else if (json.games.length === 0) setError(`No ${roundName(round)} games found for the ${settings.season} season yet.`);
      else setScheduleGames(json.games);
    } catch (e) {
      setError("Couldn't reach the schedule service: " + e.message);
    }
    setBusy(false);
  };

  const alreadyAdded = (g) => games.some((x) => x.home === g.home && x.away === g.away);

  const addScheduleGames = async (list) => {
    const toAdd = list.filter((g) => !alreadyAdded(g));
    if (toAdd.length > 0) {
      await insertGames(
        toAdd.map((g) => ({
          round,
          home: g.home,
          away: g.away,
          spread: halfPointSpread(g.spread) ?? 0,
          total: halfPointTotal(g.total),
          game_date: g.game_date || null,
          kickoff: g.kickoff || null,
        }))
      );
    }
    setScheduleGames((prev) => prev.filter((g) => !toAdd.includes(g)));
    if (toAdd.length < list.length) setMessage(`Skipped ${list.length - toAdd.length} game(s) already in this round.`);
  };

  // Refreshes kickoffs and final scores, and -- until the lines freeze --
  // spreads and totals (with the half-point rule applied).
  const syncFromSchedule = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/schedule?week=${nflWeek}&season=${settings.season}&playoffs=1`);
      const json = await res.json();
      if (json.error) { setError(json.error); setBusy(false); return; }
      let lines = 0;
      let frozen = 0;
      let scores = 0;
      let kickoffs = 0;
      for (const g of games) {
        const match = (json.games || []).find((m) => m.home === g.home && m.away === g.away);
        if (!match) continue;
        const patch = {};
        const spread = halfPointSpread(match.spread);
        const total = halfPointTotal(match.total);
        const lineChanged = (spread != null && spread !== Number(g.spread)) || (total != null && total !== Number(g.total));
        if (lineChanged && linesFrozen) frozen += 1;
        else if (lineChanged) {
          if (spread != null) patch.spread = spread;
          if (total != null) patch.total = total;
          lines += 1;
        }
        if (match.kickoff && (!g.kickoff || new Date(g.kickoff).getTime() !== new Date(match.kickoff).getTime())) {
          patch.kickoff = match.kickoff;
          patch.game_date = match.game_date;
          kickoffs += 1;
        }
        if (match.completed && (match.home_score !== g.home_score || match.away_score !== g.away_score)) {
          patch.home_score = match.home_score;
          patch.away_score = match.away_score;
          scores += 1;
        }
        if (Object.keys(patch).length > 0) await updateGame(g.id, patch);
      }
      setMessage(
        `Updated ${lines} line(s), ${kickoffs} kickoff time(s), and ${scores} final score(s).` +
          (frozen > 0 ? ` Left ${frozen} line(s) alone because this round's lines are locked.` : "")
      );
    } catch (e) {
      setError("Couldn't reach the schedule service: " + e.message);
    }
    setBusy(false);
  };

  const removeGame = async (g) => {
    if (!confirm(`Remove ${matchupLabel(g)} from the ${roundName(round)}? Anyone who picked it will have to pick again.`)) return;
    const { error: err } = await supabase.from("playoff_games").delete().eq("id", g.id);
    if (err) { setError(err.message); return; }
    changeGames((all) => all.filter((x) => x.id !== g.id));
    // Picks on it were voided (game_id cleared); reload so they show that way.
    setRevealedRows(await fetchAllRows("playoff_revealed_picks", "*", "id"));
  };

  const saveLine = async (g, field, raw) => {
    const value = field === "spread" ? halfPointSpread(raw) : halfPointTotal(raw);
    if (field === "spread" && value == null) return;
    if (value === (g[field] == null ? null : Number(g[field]))) return;
    await updateGame(g.id, { [field]: value });
  };

  const saveScore = async (g, field, raw) => {
    const value = raw === "" ? null : Number(raw);
    if (value !== null && !Number.isInteger(value)) return;
    if (value === g[field]) return;
    await updateGame(g.id, { [field]: value });
  };

  // --- entries and picks ---
  const picksByEntry = picksFromRevealed(revealedRows);
  const statusByEntry = {};
  entries.forEach((e) => { statusByEntry[e.id] = computePlayoffStatus(picksByEntry[e.id] || {}, gamesByRound); });

  const setPickFor = async (entry, value) => {
    const existing = picksByEntry[entry.id]?.[round];
    if (existing?.hidden && !confirm(`${entry.label} already has a pick you can't see until picks lock. Replace it?`)) return;
    const [gameId, choice] = value ? value.split("|") : [null, null];
    const { error: err } = await supabase.rpc("admin_set_playoff_pick", {
      p_entry_id: entry.id,
      p_round: round,
      p_game_id: gameId,
      p_choice: choice,
    });
    if (err) { alert(`Couldn't save pick: ${err.message}`); return; }
    setRevealedRows(await fetchAllRows("playoff_revealed_picks", "*", "id"));
  };

  const deleteEntry = async (entry) => {
    if (!confirm(`Delete playoff entry "${entry.label}" (${entry.email}) and all of its picks? This can't be undone.`)) return;
    const { error: err } = await supabase.from("playoff_entries").delete().eq("id", entry.id);
    if (err) { alert("Couldn't delete: " + err.message); return; }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
  };

  const savePayment = async (userId, note) => {
    if ((payments[userId] || "") === note) return;
    const { error: err } = await supabase.from("playoff_payments").upsert({ user_id: userId, note }, { onConflict: "user_id" });
    if (err) { setError(err.message); return; }
    setPayments((p) => ({ ...p, [userId]: note }));
  };

  const people = {};
  entries.forEach((e) => {
    people[e.user_id] = people[e.user_id] || { userId: e.user_id, email: e.email, count: 0 };
    people[e.user_id].count += 1;
  });

  const filteredEntries = entries.filter((e) => {
    const q = search.toLowerCase();
    return !q || (e.label || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q);
  });

  const lineInputsDisabled = linesFrozen && !editLockedLines;

  return (
    <div className="grid gap-8">
      {error && <p className="text-rust text-sm">{error}</p>}

      <div className="border border-turfline rounded-lg p-4 grid gap-3">
        <label className="text-sm font-bold flex items-center gap-2">
          <input type="checkbox" checked={!!settings.visible} onChange={() => saveSetting({ visible: !settings.visible })} />
          Show the playoff pool to everyone
        </label>
        <p className="text-xs text-chalk/50 -mt-2">
          Off: only admins see the Playoffs link and pages. On: everyone sees them in the menu.
        </p>
        <label className="text-sm font-bold flex items-center gap-2">
          <input type="checkbox" checked={!!settings.entries_open} onChange={() => saveSetting({ entries_open: !settings.entries_open })} />
          Playoff entries open (people can sign up and add up to 4 entries)
        </label>
        <p className="text-xs text-chalk/50 -mt-2">
          This also reopens the sign-up page for new people while regular-season sign-ups are locked. If you turned
          off "Allow new users to sign up" in Supabase's Authentication settings, turn that back on too.
        </p>
        <div className="grid gap-2">
          <div className="text-sm font-bold">Pay links ($100 per entry)</div>
          <p className="text-xs text-chalk/50 -mt-1">
            Players see "Pay with Venmo" / "Pay with PayPal" buttons on their playoff entries page, with the amount
            for their number of entries already filled in. Leave one blank to hide that button.
          </p>
          <label className="text-xs flex items-center gap-2">
            Venmo username
            <input
              className="w-56"
              placeholder="e.g. @Your-Name"
              defaultValue={settings.venmo_username || ""}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (settings.venmo_username || null)) saveSetting({ venmo_username: v }); }}
            />
          </label>
          <label className="text-xs flex items-center gap-2">
            PayPal.me username
            <input
              className="w-56"
              placeholder="the part after paypal.me/"
              defaultValue={settings.paypal_username || ""}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (settings.paypal_username || null)) saveSetting({ paypal_username: v }); }}
            />
          </label>
        </div>
        <label className="text-xs flex items-center gap-2">
          Season (the year the regular season started)
          <input
            type="number"
            className="w-24"
            defaultValue={settings.season}
            onBlur={(e) => { const v = Number(e.target.value); if (v && v !== settings.season) saveSetting({ season: v }); }}
          />
        </label>
      </div>

      <div>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <select value={round} onChange={(e) => setRound(Number(e.target.value))} className="w-64">
            {ROUNDS.map((r) => <option key={r.round} value={r.round}>{r.name}</option>)}
          </select>
          {games.length > 0 && (
            <span className="text-sm font-bold text-amber">
              Lines {linesFrozen ? "locked" : "lock"} {formatCentral(lockAt)} · Picks lock {formatCentral(roundLockTime(games))}
            </span>
          )}
        </div>
        {auto && (
          <p className="text-xs text-chalk/60 mb-3">
            No-pick auto-pick: {pickLabel(auto.game, auto.choice)} — entries without a pick when picks lock get it.
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap mb-3">
          <button className="btn-ghost" onClick={fetchSchedule} disabled={busy}>
            {busy ? "Working…" : `Fetch ${roundName(round)} games (${settings.season} season)`}
          </button>
          <button className="btn-ghost" onClick={syncFromSchedule} disabled={busy || games.length === 0}>
            Sync lines, kickoffs & scores
          </button>
        </div>
        <p className="text-xs text-chalk/50 mb-3">
          Whole-number lines from the feed get the half point added automatically. Lines stop syncing once they lock
          Wednesday at 1:00 PM; kickoffs and final scores keep syncing. Run the sync on Wednesday morning to pick up
          the latest lines, and again after the games to grade them.
        </p>
        {message && <p className="text-leaf text-sm mb-3">{message}</p>}

        {scheduleGames.length > 0 && (
          <div className="grid gap-2 mb-4 border border-turfline rounded-lg p-3">
            <button className="btn-primary w-fit" onClick={() => addScheduleGames(scheduleGames)}>
              Add all {scheduleGames.length} games
            </button>
            {scheduleGames.map((g, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap text-sm border-t border-turfline pt-2">
                <span className="flex-1 min-w-[220px]">
                  {matchupLabel(g)}
                  <span className="text-chalk/40 text-xs">
                    {" "}— {g.game_date} — spread {halfPointSpread(g.spread) ?? "not posted"}, total {halfPointTotal(g.total) ?? "not posted"}
                  </span>
                </span>
                <button className="btn-ghost" onClick={() => addScheduleGames([g])}>Add</button>
              </div>
            ))}
          </div>
        )}

        {linesFrozen && games.length > 0 && (
          <label className="text-xs flex items-center gap-2 mb-2 text-amber">
            <input type="checkbox" checked={editLockedLines} onChange={(e) => setEditLockedLines(e.target.checked)} />
            Let me correct a locked line (only to fix a mistake — players already picked against these)
          </label>
        )}

        <div className="grid gap-2">
          {games.map((g) => (
            <div key={g.id} className="border border-turfline rounded-lg p-3 grid gap-2">
              <div className="flex gap-2 flex-wrap items-center">
                <select value={g.away} onChange={(e) => updateGame(g.id, { away: e.target.value })} className="w-52">
                  {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-xs text-chalk/50">@</span>
                <select value={g.home} onChange={(e) => updateGame(g.id, { home: e.target.value })} className="w-52">
                  {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {gameStarted(g) && <span className="pill pill-gray">Kicked off</span>}
              </div>
              <div className="flex gap-3 flex-wrap items-center text-xs">
                <label className="flex items-center gap-1" title="Relative to the home team: negative = home favored">
                  Home spread
                  <input
                    key={`s${g.spread}`}
                    type="number"
                    step="0.5"
                    defaultValue={g.spread}
                    disabled={lineInputsDisabled}
                    onBlur={(e) => saveLine(g, "spread", e.target.value)}
                    className="w-20"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Total
                  <input
                    key={`t${g.total}`}
                    type="number"
                    step="0.5"
                    defaultValue={g.total ?? ""}
                    disabled={lineInputsDisabled}
                    onBlur={(e) => saveLine(g, "total", e.target.value)}
                    className="w-20"
                  />
                </label>
                <span className="text-chalk/50">{pickLabel(g, "away")} / {pickLabel(g, "home")}</span>
              </div>
              <div className="flex gap-3 flex-wrap items-center text-xs">
                <label className="flex items-center gap-1">
                  Kickoff (Central)
                  <input
                    key={`k${g.kickoff}`}
                    type="datetime-local"
                    defaultValue={toCentralInput(g.kickoff)}
                    onBlur={(e) => { const v = fromCentralInput(e.target.value); if (v && v.kickoff !== g.kickoff) updateGame(g.id, v); }}
                  />
                </label>
                <label className="flex items-center gap-1">
                  Final score: {g.away.split(" ").slice(-1)[0]}
                  <input key={`a${g.away_score}`} type="number" defaultValue={g.away_score ?? ""} onBlur={(e) => saveScore(g, "away_score", e.target.value)} className="w-16" />
                </label>
                <label className="flex items-center gap-1">
                  {g.home.split(" ").slice(-1)[0]}
                  <input key={`h${g.home_score}`} type="number" defaultValue={g.home_score ?? ""} onBlur={(e) => saveScore(g, "home_score", e.target.value)} className="w-16" />
                </label>
                <button className="btn-ghost text-rust border-rust" onClick={() => removeGame(g)}>Remove</button>
              </div>
            </div>
          ))}
          {games.length === 0 && <p className="text-chalk/50 text-sm">No games in this round yet.</p>}
        </div>
        <button
          className="btn-primary mt-3"
          onClick={() => insertGames([{ round, home: TEAMS[0], away: TEAMS[1], spread: 0, total: null }])}
        >
          + Add game
        </button>
      </div>

      <div>
        <div className="text-sm font-bold mb-1">Entries — {roundName(round)} picks</div>
        <p className="text-xs text-chalk/50 mb-3">
          Sets a pick directly, bypassing the lock rules — for picks called or texted in. Picks stay hidden here too,
          even from you, until the round's picks lock. {entries.length} playoff entries total.
        </p>
        <input
          placeholder="Search by entry or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm mb-3"
        />
        <div className="grid gap-2">
          {filteredEntries.map((entry) => {
            const status = statusByEntry[entry.id];
            const d = status?.detail[round] || {};
            const stored = picksByEntry[entry.id]?.[round];
            const value = stored && !stored.hidden && !stored.voided ? `${stored.gameId}|${stored.choice}` : "";
            return (
              <div key={entry.id} className="border border-turfline rounded-lg p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-sm flex items-center gap-2">
                    {entry.label}
                    {status?.eliminated ? (
                      <span className="pill pill-red">Out — {roundName(status.eliminatedRound)}</span>
                    ) : (
                      <span className="pill pill-green">Alive</span>
                    )}
                  </div>
                  <div className="text-xs text-chalk/50">{entry.email}</div>
                </div>
                <select value={value} onChange={(e) => setPickFor(entry, e.target.value)} className="w-72">
                  <option value="">
                    {stored?.hidden ? "— Hidden until picks lock —" : d.auto ? `— No pick (auto: ${pickLabel(d.game, d.choice)}) —` : "— No pick —"}
                  </option>
                  {games.flatMap((g) =>
                    ["away", "home", "over", "under"].map((c) => (
                      <option key={`${g.id}|${c}`} value={`${g.id}|${c}`}>{pickLabel(g, c)}</option>
                    ))
                  )}
                </select>
                <button className="btn-ghost text-rust border-rust" onClick={() => deleteEntry(entry)}>Delete entry</button>
              </div>
            );
          })}
          {filteredEntries.length === 0 && <p className="text-chalk/50 text-sm">No playoff entries.</p>}
        </div>
      </div>

      <div>
        <div className="text-sm font-bold mb-2">Payments</div>
        <div className="grid gap-2">
          {Object.values(people).map((p) => (
            <div key={p.userId} className="flex items-center gap-3 flex-wrap text-sm border-t border-turfline pt-2">
              <span className="flex-1 min-w-[200px]">
                {p.email} <span className="text-chalk/50 text-xs">· {p.count} entr{p.count === 1 ? "y" : "ies"}</span>
              </span>
              <input
                placeholder="How they paid (e.g. Venmo, cash)"
                defaultValue={payments[p.userId] || ""}
                onBlur={(e) => savePayment(p.userId, e.target.value)}
                className="flex-1 min-w-[200px]"
              />
            </div>
          ))}
          {Object.keys(people).length === 0 && <p className="text-chalk/50 text-sm">No one yet.</p>}
        </div>
      </div>
    </div>
  );
}
