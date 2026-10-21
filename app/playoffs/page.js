"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import {
  MAX_PLAYOFF_ENTRIES,
  PLAYOFF_ENTRY_FEE,
  venmoPayUrl,
  paypalPayUrl,
  ROUNDS,
  roundName,
  choiceLine,
  pickLabel,
  shortPickLabel,
  matchupLabel,
  gameKickoff,
  linesLockTime,
  linesLocked,
  roundLockTime,
  roundLocked,
  formatCentral,
  autoPickFor,
  currentRound,
  computePlayoffStatus,
  groupGamesByRound,
  picksFromRows,
} from "../../lib/playoffLogic";

function Pill({ tone = "gray", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

const RESULT_TONE = { win: "green", push: "green", loss: "red", nopick: "red", invalid: "red", pending: "amber" };

export default function PlayoffEntriesPage() {
  const router = useRouter();
  const { user, isAdmin, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState(null);
  const [entries, setEntries] = useState([]);
  const [pickRows, setPickRows] = useState([]);
  const [gamesByRound, setGamesByRound] = useState({});
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [newLabel, setNewLabel] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [error, setError] = useState("");
  const [loadingData, setLoadingData] = useState(true);
  // Re-render every 30s so games lock on screen at kickoff without a reload.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    const { data: settingsRow } = await supabase.from("playoff_settings").select("*").eq("id", 1).maybeSingle();
    setSettings(settingsRow || null);

    const { data: entryRows } = await supabase
      .from("playoff_entries")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    setEntries(entryRows || []);

    const { data: gameRows } = await supabase.from("playoff_games").select("*");
    setGamesByRound(groupGamesByRound(gameRows));

    if (entryRows && entryRows.length > 0) {
      const { data: rows } = await supabase.from("playoff_picks").select("*").in("entry_id", entryRows.map((e) => e.id));
      setPickRows(rows || []);
    } else {
      setPickRows([]);
    }
    setLoadingData(false);
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    load();
  }, [load]);

  const addEntry = async () => {
    setError("");
    if (entries.length >= MAX_PLAYOFF_ENTRIES) return;
    const label = newLabel.trim() || `Playoff Entry ${entries.length + 1}`;
    const { data, error: insErr } = await supabase
      .from("playoff_entries")
      .insert({ user_id: user.id, email: user.email, label })
      .select()
      .single();
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setEntries((prev) => [...prev, data]);
    setSelectedEntryId(data.id);
    setAddingEntry(false);
    setNewLabel("");
  };

  // An entry with a pick row changes it (update); one without adds one
  // (insert). Not an upsert: the database checks an upsert against the
  // "new pick" rule even when it ends up changing an existing pick.
  const savePick = async (entryId, round, gameId, choice) => {
    setError("");
    const existing = pickRows.find((p) => p.entry_id === entryId && p.round === round);
    const query = existing
      ? supabase.from("playoff_picks").update({ game_id: gameId, choice }).eq("id", existing.id)
      : supabase.from("playoff_picks").insert({ entry_id: entryId, round, game_id: gameId, choice });
    const { data, error: pickErr } = await query.select().single();
    if (pickErr) {
      setError(`Pick not saved: ${pickErr.message}. That game may have just locked — reload and try again.`);
      return false;
    }
    setPickRows((prev) => [...prev.filter((p) => p.id !== data.id), data]);
    return true;
  };

  const clearPick = async (pick) => {
    setError("");
    const { data, error: delErr } = await supabase.from("playoff_picks").delete().eq("id", pick.id).select();
    if (delErr || !data || data.length === 0) {
      setError(`Pick not cleared${delErr ? `: ${delErr.message}` : ""}. It may have just locked — reload to check.`);
      return;
    }
    setPickRows((prev) => prev.filter((p) => p.id !== pick.id));
  };

  const renameEntry = async (entryId, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const { error: renameErr } = await supabase.from("playoff_entries").update({ label: trimmed }).eq("id", entryId);
    if (renameErr) {
      setError(renameErr.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, label: trimmed } : e)));
  };

  if (authLoading || loadingData) return <p className="text-chalk/60">Loading…</p>;

  const picksByEntry = picksFromRows(pickRows);
  const selectedEntry = entries.find((e) => e.id === selectedEntryId);
  const roundNums = ROUNDS.map((r) => r.round).filter((r) => (gamesByRound[r] || []).length > 0);
  const canAdd = settings?.entries_open || isAdmin;

  return (
    <div>
      {error && <p className="text-rust text-sm mb-4">{error}</p>}

      {!selectedEntry && (
        <>
          <div className="grid gap-2 mb-4">
            {entries.length === 0 && <p className="text-chalk/60 text-sm">No playoff entries yet.</p>}
            {entries.map((entry) => {
              const status = computePlayoffStatus(picksByEntry[entry.id] || {}, gamesByRound, now);
              return (
                <div
                  key={entry.id}
                  onClick={() => setSelectedEntryId(entry.id)}
                  className="cursor-pointer bg-white/5 border border-turfline rounded-lg px-4 py-3 hover:border-amber transition-colors"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold">{entry.label}</span>
                    {status.eliminated ? (
                      <Pill tone="red">Out — {roundName(status.eliminatedRound)}</Pill>
                    ) : (
                      <Pill tone="green">Alive</Pill>
                    )}
                  </div>
                  {roundNums.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {roundNums.map((r) => {
                        const d = status.detail[r] || {};
                        return (
                          <div key={r} className="text-xs">
                            <span className="text-chalk/40 mr-1">{roundName(r)}:</span>
                            <Pill tone={RESULT_TONE[d.result] || "gray"}>
                              {d.game ? shortPickLabel(d.game, d.choice) : d.result === "invalid" ? "Pick again" : "—"}
                              {d.auto ? " (auto)" : ""}
                            </Pill>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {entries.length > 0 && <PayCard entries={entries} settings={settings} user={user} />}

          {entries.length >= MAX_PLAYOFF_ENTRIES ? (
            <p className="text-xs text-chalk/50">You've reached the {MAX_PLAYOFF_ENTRIES}-entry limit for the playoff pool.</p>
          ) : !canAdd ? (
            <p className="text-xs text-chalk/50">New playoff entries are closed.</p>
          ) : addingEntry ? (
            <div className="flex gap-2">
              <input
                placeholder={`Playoff entry ${entries.length + 1} nickname (optional)`}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button className="btn-primary" onClick={addEntry}>Add</button>
            </div>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => setAddingEntry(true)}>
                + Add playoff entry ({entries.length}/{MAX_PLAYOFF_ENTRIES})
              </button>
              {!settings?.entries_open && (
                <p className="text-xs text-amber mt-2">
                  Entries are closed to players right now; you can add one because you're an admin.
                </p>
              )}
            </>
          )}
        </>
      )}

      {selectedEntry && (
        <EntryDetail
          entry={selectedEntry}
          picks={picksByEntry[selectedEntry.id] || {}}
          pickRows={pickRows.filter((p) => p.entry_id === selectedEntry.id)}
          gamesByRound={gamesByRound}
          roundNums={roundNums}
          now={now}
          savePick={savePick}
          clearPick={clearPick}
          renameEntry={renameEntry}
          onBack={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}

// Pay buttons for $100 x this account's entries. The amount and a note naming
// the entries are filled in, so the payment is easy to match up in Admin.
function PayCard({ entries, settings, user }) {
  const amount = PLAYOFF_ENTRY_FEE * entries.length;
  const note = `Playoff pool: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} (${entries.map((e) => e.label).join(", ")}) - ${user.email}`;
  const venmo = venmoPayUrl(settings?.venmo_username, amount, note);
  const paypal = paypalPayUrl(settings?.paypal_username, amount);
  if (!venmo && !paypal) return null;

  return (
    <div className="border border-turfline rounded-lg px-4 py-3 mb-4">
      <div className="text-sm font-bold mb-1">
        Entry fee: ${PLAYOFF_ENTRY_FEE} per entry — ${amount} for your {entries.length} entr{entries.length === 1 ? "y" : "ies"}
      </div>
      <p className="text-xs text-chalk/50 mb-3">
        Already paid? You're all set. If you add another entry later, just pay for the new one.
      </p>
      <div className="flex gap-2 flex-wrap">
        {venmo && (
          <a href={venmo} target="_blank" rel="noopener noreferrer" className="btn-primary">Pay ${amount} with Venmo</a>
        )}
        {paypal && (
          <a href={paypal} target="_blank" rel="noopener noreferrer" className="btn-ghost">Pay ${amount} with PayPal</a>
        )}
      </div>
    </div>
  );
}

function EntryDetail({ entry, picks, pickRows, gamesByRound, roundNums, now, savePick, clearPick, renameEntry, onBack }) {
  const status = computePlayoffStatus(picks, gamesByRound, now);
  const round = currentRound(gamesByRound);
  const games = gamesByRound[round] || [];
  const pickRow = pickRows.find((p) => p.round === round) || null;
  const savedGame = pickRow?.game_id ? games.find((g) => g.id === pickRow.game_id) : null;
  const d = status.detail[round] || {};
  const auto = autoPickFor(games);
  const lockAt = linesLockTime(games);
  const picksLockAt = roundLockTime(games);
  const locked = roundLocked(games, now);

  const [staged, setStaged] = useState(null); // { gameId, choice }
  const [justSaved, setJustSaved] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(entry.label);

  const isSaved = (gameId, choice) => !!savedGame && savedGame.id === gameId && pickRow.choice === choice;
  const selected = staged || (savedGame ? { gameId: savedGame.id, choice: pickRow.choice } : null);
  const hasUnsaved = !!staged && !isSaved(staged.gameId, staged.choice);
  const LEAVE_WARNING = "You chose a pick but haven't saved it yet. Leave without saving?";

  useEffect(() => {
    if (!hasUnsaved) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

  const handleBack = () => {
    if (hasUnsaved && !window.confirm(LEAVE_WARNING)) return;
    onBack();
  };

  const handleSave = async () => {
    if (!staged) return;
    if (await savePick(entry.id, round, staged.gameId, staged.choice)) {
      setStaged(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  };

  const handleSaveName = async () => {
    await renameEntry(entry.id, nameInput);
    setEditingName(false);
  };

  const stagedGame = staged ? games.find((g) => g.id === staged.gameId) : null;

  let pickSection = null;
  if (status.eliminated) {
    pickSection = null;
  } else if (games.length === 0) {
    pickSection = <p className="text-sm text-chalk/50 mb-6">No playoff games are loaded yet.</p>;
  } else if (!linesLocked(games, now)) {
    pickSection = (
      <div className="mb-8">
        <div className="text-sm font-bold mb-1">{roundName(round)}</div>
        <p className="text-sm text-amber mb-3">
          Lines lock and picks open {formatCentral(lockAt)}. The lines below can still move until then.
        </p>
        <div className="grid gap-2">
          {games.map((g) => (
            <div key={g.id} className="border border-turfline rounded-lg px-3 py-2 text-sm">
              <div className="font-bold">{matchupLabel(g)}</div>
              <div className="text-chalk/60 text-xs">
                {g.away} {choiceLine(g, "away")} · {g.home} {choiceLine(g, "home")} · Total {choiceLine(g, "over")} ·
                Kicks off {formatCentral(gameKickoff(g))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (locked) {
    pickSection = (
      <div className="mb-8 border border-turfline rounded-lg px-4 py-3">
        {d.auto ? (
          <>
            <div className="text-sm font-bold">{roundName(round)}: {pickLabel(d.game, d.choice)} (auto-assigned)</div>
            <p className="text-xs text-chalk/50 mt-1">
              No pick was in when picks locked at {formatCentral(picksLockAt)}, so this entry got the biggest favorite.
            </p>
          </>
        ) : d.game ? (
          <>
            <div className="text-sm font-bold">{roundName(round)} — locked in: {pickLabel(d.game, d.choice)}</div>
            <p className="text-xs text-chalk/50 mt-1">Picks locked {formatCentral(picksLockAt)} and can no longer be changed.</p>
          </>
        ) : (
          <div className="text-sm font-bold">{roundName(round)} — picks locked {formatCentral(picksLockAt)}.</div>
        )}
      </div>
    );
  } else {
    pickSection = (
      <div className="mb-8">
        <div className="text-sm font-bold mb-1">{roundName(round)} pick</div>
        <p className="text-xs text-chalk/50 mb-2">
          Pick one: a team against the spread, or the over or under on one game. All picks lock{" "}
          {formatCentral(picksLockAt)}, one hour before the first game.
        </p>
        <div className="text-sm mb-3">
          {pickRow && !savedGame ? (
            <div className="border border-rust rounded-lg px-4 py-3">
              <div className="text-rust font-bold">Your pick no longer counts</div>
              <p className="text-xs text-chalk/70 mt-1">That game was taken off the board. Please pick again below.</p>
            </div>
          ) : savedGame ? (
            <span className="text-leaf font-bold">Saved pick: {pickLabel(savedGame, pickRow.choice)}</span>
          ) : (
            <span className="text-amber font-bold">No pick saved yet</span>
          )}
        </div>
        {(!pickRow || !savedGame) && auto && (
          <p className="text-xs text-chalk/60 mb-3">
            If you don't have a pick in by then, you'll get the biggest favorite: {pickLabel(auto.game, auto.choice)}.
          </p>
        )}

        <div className="grid gap-2">
          {games.map((g) => {
            return (
              <div key={g.id} className="border border-turfline rounded-lg px-3 py-3">
                <div className="text-sm font-bold text-chalk mb-2">
                  {matchupLabel(g)} · Kicks off {formatCentral(gameKickoff(g))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { choice: "away", text: `${g.away} ${choiceLine(g, "away")}` },
                    { choice: "home", text: `${g.home} ${choiceLine(g, "home")}` },
                    { choice: "over", text: `Over ${choiceLine(g, "over")}` },
                    { choice: "under", text: `Under ${choiceLine(g, "under")}` },
                  ].map((opt) => {
                    const isSel = selected && selected.gameId === g.id && selected.choice === opt.choice;
                    const disabled = (opt.choice === "over" || opt.choice === "under") && g.total == null;
                    return (
                      <button
                        key={opt.choice}
                        disabled={disabled}
                        onClick={() => setStaged({ gameId: g.id, choice: opt.choice })}
                        className="rounded-md px-3 py-2 text-sm text-left"
                        style={{
                          border: isSel ? "2px solid #F2661A" : "1px solid #3A4756",
                          background: isSel ? "rgba(242,102,26,0.15)" : "transparent",
                          fontWeight: isSel ? 800 : 500,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        {opt.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button className="btn-primary" disabled={!hasUnsaved} onClick={handleSave}>
            {pickRow ? "Update pick" : "Submit pick"}
          </button>
          {pickRow && (
            <button className="btn-ghost text-rust border-rust" onClick={() => { setStaged(null); clearPick(pickRow); }}>
              Clear pick
            </button>
          )}
          {justSaved && <span className="text-leaf text-sm">Saved.</span>}
          {hasUnsaved && !justSaved && (
            <span className="text-xs font-bold text-amber">
              {pickLabel(stagedGame, staged.choice)} is NOT saved yet — tap {pickRow ? "Update pick" : "Submit pick"}.
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button className="btn-ghost mb-4" onClick={handleBack}>← Back to playoff entries</button>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {editingName ? (
          <>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="w-48" autoFocus />
            <button className="btn-primary" onClick={handleSaveName}>Save</button>
            <button className="btn-ghost" onClick={() => { setNameInput(entry.label); setEditingName(false); }}>Cancel</button>
          </>
        ) : (
          <>
            <span className="font-black uppercase text-lg">{entry.label}</span>
            <button className="btn-ghost" onClick={() => setEditingName(true)}>Rename</button>
          </>
        )}
        {status.eliminated ? (
          <Pill tone="red">Out — {status.reason} ({roundName(status.eliminatedRound)})</Pill>
        ) : (
          <Pill tone="green">Alive</Pill>
        )}
      </div>

      {pickSection}

      <div className="text-sm font-bold mb-2">Pick history</div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-chalk/50">
            <th className="py-1 px-2">Round</th>
            <th className="py-1 px-2">Pick</th>
            <th className="py-1 px-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {roundNums.map((r) => {
            const rd = status.detail[r] || {};
            return (
              <tr key={r} className="border-t border-turfline">
                <td className="py-1 px-2">{roundName(r)}</td>
                <td className="py-1 px-2">
                  {rd.game ? pickLabel(rd.game, rd.choice) : "—"}
                  {rd.auto && <span className="text-amber text-xs ml-1">(auto)</span>}
                </td>
                <td className="py-1 px-2">
                  {rd.result === "win" && <Pill tone="green">Win</Pill>}
                  {rd.result === "push" && <Pill tone="green">Push — advances</Pill>}
                  {rd.result === "loss" && <Pill tone="red">Loss</Pill>}
                  {rd.result === "nopick" && <Pill tone="red">No pick</Pill>}
                  {rd.result === "invalid" && <Pill tone="red">Doesn't count — pick again</Pill>}
                  {rd.result === "pending" && <Pill tone="amber">Pending</Pill>}
                  {rd.result === "upcoming" && <Pill tone="gray">Upcoming</Pill>}
                  {rd.result === "na" && <Pill tone="gray">—</Pill>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
