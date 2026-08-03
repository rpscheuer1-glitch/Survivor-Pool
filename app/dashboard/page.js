"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import { ineligible, ruleLabel, computeStatus, MAX_ENTRIES_PER_ACCOUNT, isLocked, formatGameDate, formatLockLabel, computeAutoCurrentWeek } from "../../lib/poolLogic";
import { abbr } from "../../lib/teams";

function Pill({ tone = "gray", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState({ current_week: 1, pool_name: "Survivor Pool" });
  const [entries, setEntries] = useState([]);
  const [picksByEntry, setPicksByEntry] = useState({}); // entryId -> {week: team}
  const [gamesByWeek, setGamesByWeek] = useState({});
  const [finalByWeek, setFinalByWeek] = useState({});
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [newLabel, setNewLabel] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [error, setError] = useState("");
  const [loadingData, setLoadingData] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);

    const { data: settingsRow } = await supabase.from("pool_settings").select("*").eq("id", 1).single();
    if (settingsRow) setSettings(settingsRow);

    const { data: entryRows } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    setEntries(entryRows || []);

    const { data: gameRows } = await supabase.from("games").select("*");
    const gbw = {};
    (gameRows || []).forEach((g) => {
      gbw[g.week] = gbw[g.week] || [];
      gbw[g.week].push(g);
    });
    Object.keys(gbw).forEach((wk) => {
      gbw[wk].sort((a, b) => (a.game_date || "9999-99-99").localeCompare(b.game_date || "9999-99-99"));
    });
    setGamesByWeek(gbw);

    const { data: weekRows } = await supabase.from("weeks").select("*");
    const fbw = {};
    (weekRows || []).forEach((w) => (fbw[w.week] = w.final));
    setFinalByWeek(fbw);

    if (entryRows && entryRows.length > 0) {
      const ids = entryRows.map((e) => e.id);
      const { data: pickRows } = await supabase.from("picks").select("*").in("entry_id", ids);
      const pbe = {};
      (pickRows || []).forEach((p) => {
        pbe[p.entry_id] = pbe[p.entry_id] || {};
        pbe[p.entry_id][p.week] = { team: p.team, auto: p.auto_assigned };
      });
      setPicksByEntry(pbe);
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
    if (entries.length >= MAX_ENTRIES_PER_ACCOUNT) return;
    const label = newLabel.trim() || `Entry ${entries.length + 1}`;
    const { data, error: insErr } = await supabase
      .from("entries")
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

  const submitPick = async (entryId, week, team) => {
    // A person submitting their own pick always overrides any prior auto-assignment.
    const { error: pickErr } = await supabase
      .from("picks")
      .upsert({ entry_id: entryId, week, team, auto_assigned: false }, { onConflict: "entry_id,week" });
    if (pickErr) {
      setError(pickErr.message);
      return;
    }
    setPicksByEntry((prev) => ({
      ...prev,
      [entryId]: { ...(prev[entryId] || {}), [week]: { team, auto: false } },
    }));
  };

  if (authLoading || loadingData) return <p className="text-chalk/60">Loading…</p>;

  const selectedEntry = entries.find((e) => e.id === selectedEntryId);
  const currentWeek = computeAutoCurrentWeek(gamesByWeek);
  const weekNums = Object.keys(gamesByWeek).map(Number).sort((a, b) => a - b);

  return (
    <div>
      {error && <p className="text-rust text-sm mb-4">{error}</p>}

      {!selectedEntry && (
        <>
          <div className="grid gap-2 mb-4">
            {entries.length === 0 && <p className="text-chalk/60 text-sm">No entries yet.</p>}
            {entries.map((entry) => {
              const status = computeStatus(picksByEntry[entry.id] || {}, gamesByWeek, finalByWeek);
              return (
                <div
                  key={entry.id}
                  onClick={() => setSelectedEntryId(entry.id)}
                  className="cursor-pointer bg-white/5 border border-turfline rounded-lg px-4 py-3 hover:border-amber transition-colors"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold">{entry.label}</span>
                    {status.eliminated ? (
                      <Pill tone="red">Eliminated wk {status.eliminatedWeek}</Pill>
                    ) : (
                      <Pill tone="green">Alive</Pill>
                    )}
                  </div>
                  {weekNums.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {weekNums.map((wk) => {
                        const d = status.detail[wk] || {};
                        const tone =
                          d.result === "win" ? "green" :
                          d.result === "loss" || d.result === "nopick" ? "red" :
                          d.result === "pending" ? "amber" : "gray";
                        const toneColors = {
                          green: { bg: "rgba(63,166,108,0.22)", fg: "#3FA66C" },
                          red: { bg: "rgba(214,69,58,0.22)", fg: "#D6453A" },
                          amber: { bg: "rgba(242,102,26,0.2)", fg: "#c2570f" },
                          gray: { bg: "rgba(150,165,180,0.14)", fg: "#8695a6" },
                        }[tone];
                        return (
                          <div key={wk} title={d.auto ? `Week ${wk} — auto-assigned: ${d.autoNote}` : `Week ${wk}`} className="flex flex-col items-center flex-shrink-0" style={{ minWidth: 38 }}>
                            <span className="text-[10px] text-chalk/40 mb-0.5">W{wk}</span>
                            <span
                              className="text-[11px] font-black rounded px-1.5 py-1 text-center"
                              style={{ background: toneColors.bg, color: toneColors.fg, minWidth: 36 }}
                            >
                              {d.pick ? abbr(d.pick) : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {settings.signups_locked ? (
            <p className="text-xs text-chalk/50">New entries are closed for this pool.</p>
          ) : entries.length < MAX_ENTRIES_PER_ACCOUNT ? (
            addingEntry ? (
              <div className="flex gap-2">
                <input
                  placeholder={`Entry ${entries.length + 1} nickname (optional)`}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <button className="btn-primary" onClick={addEntry}>Add</button>
              </div>
            ) : (
              <button className="btn-ghost" onClick={() => setAddingEntry(true)}>
                + Add entry ({entries.length}/{MAX_ENTRIES_PER_ACCOUNT})
              </button>
            )
          ) : (
            <p className="text-xs text-chalk/50">You've reached the {MAX_ENTRIES_PER_ACCOUNT}-entry limit for this account.</p>
          )}
        </>
      )}

      {selectedEntry && (
        <EntryDetail
          entry={selectedEntry}
          picks={picksByEntry[selectedEntry.id] || {}}
          gamesByWeek={gamesByWeek}
          finalByWeek={finalByWeek}
          currentWeek={currentWeek}
          weekNums={weekNums}
          submitPick={submitPick}
          onBack={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}

function EntryDetail({ entry, picks, gamesByWeek, finalByWeek, currentWeek, weekNums, submitPick, onBack }) {
  const status = computeStatus(picks, gamesByWeek, finalByWeek);
  const openWeeks = weekNums.filter((wk) => wk >= currentWeek && !finalByWeek[wk] && (gamesByWeek[wk] || []).length > 0);

  const [stagedPicks, setStagedPicks] = useState({});
  const [justSavedWeek, setJustSavedWeek] = useState(null);
  const [selectedPickWeek, setSelectedPickWeek] = useState(null);

  useEffect(() => {
    if (openWeeks.length > 0 && !openWeeks.includes(selectedPickWeek)) {
      setSelectedPickWeek(openWeeks[0]);
    }
  }, [openWeeks.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (wk, team) => {
    if (!team) return;
    await submitPick(entry.id, wk, team);
    setJustSavedWeek(wk);
    setTimeout(() => setJustSavedWeek(null), 1500);
  };

  return (
    <div>
      <button className="btn-ghost mb-4" onClick={onBack}>← Back to entries</button>
      <div className="flex items-center gap-3 mb-6">
        <span className="font-black uppercase text-lg">{entry.label}</span>
        {status.eliminated ? (
          <Pill tone="red">Eliminated — {status.reason} (wk {status.eliminatedWeek})</Pill>
        ) : (
          <Pill tone="green">Alive</Pill>
        )}
      </div>

      {!status.eliminated && openWeeks.length === 0 && (
        <p className="text-sm text-chalk/50 mb-6">No weeks are currently open for picks.</p>
      )}

      {!status.eliminated && openWeeks.length > 0 && (() => {
        const wk = selectedPickWeek ?? openWeeks[0];
        const weekGames = gamesByWeek[wk] || [];
        const submittedPick = picks[wk]?.team || null;
        const submittedGame = weekGames.find((g) => g.home === submittedPick || g.away === submittedPick);
        const pickLockedIn = !!(submittedPick && submittedGame && isLocked(submittedGame));
        const stagedPick = wk in stagedPicks ? stagedPicks[wk] : submittedPick || null;

        return (
          <div className="mb-8">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <div className="text-sm font-bold">Week {wk} picks</div>
              {openWeeks.length > 1 && (
                <select
                  value={wk}
                  onChange={(e) => setSelectedPickWeek(Number(e.target.value))}
                  className="w-36"
                >
                  {openWeeks.map((w) => (
                    <option key={w} value={w}>Week {w}{picks[w] ? " ✓" : ""}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-xs text-chalk/50 mb-3">{ruleLabel(wk)}</p>

            {pickLockedIn ? (
              <div className="border border-turfline rounded-lg px-4 py-3">
                <div className="text-sm font-bold">Locked in: {submittedPick}</div>
                <p className="text-xs text-chalk/50 mt-1">
                  That game has already started (or is within its lock window), so this pick can no longer be changed.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  {weekGames.map((g) => {
                    const isOut = ineligible(g.spread, wk);
                    const locked = isLocked(g);
                    const disabled = isOut || locked;
                    return (
                      <div
                        key={g.id}
                        className="relative border border-turfline rounded-lg px-3 py-3"
                        style={{ opacity: disabled ? 0.55 : 1 }}
                      >
                        {isOut && (
                          <span className="absolute top-1 right-2 text-rust text-xs font-black border border-rust rounded px-2 py-0.5 bg-chalk/10 uppercase">
                            Out — spread {Math.abs(g.spread)}
                          </span>
                        )}
                        {!isOut && locked && (
                          <span className="absolute top-1 right-2 text-rust text-xs font-black border border-rust rounded px-2 py-0.5 bg-chalk/10 uppercase">
                            Locked
                          </span>
                        )}
                        <div className="text-sm font-bold text-chalk mb-2">
                          {formatGameDate(g)} · {formatLockLabel(g)}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {[g.away, g.home].map((team) => {
                            const teamSpread = team === g.home ? Number(g.spread) : -Number(g.spread);
                            const spreadText = teamSpread === 0 ? "PK" : teamSpread > 0 ? `+${teamSpread}` : `${teamSpread}`;
                            return (
                              <button
                                key={team}
                                disabled={disabled}
                                onClick={() => setStagedPicks((prev) => ({ ...prev, [wk]: team }))}
                                className="flex-1 min-w-[140px] rounded-md px-3 py-2 text-sm"
                                style={{
                                  border: stagedPick === team ? "2px solid #F2661A" : "1px solid #3A4756",
                                  background: stagedPick === team ? "rgba(242,102,26,0.15)" : "transparent",
                                  fontWeight: stagedPick === team ? 800 : 500,
                                  cursor: disabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {team} <span className="text-chalk/50 font-normal">{spreadText}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    className="btn-primary"
                    disabled={!stagedPick || stagedPick === submittedPick}
                    onClick={() => handleSubmit(wk, stagedPick)}
                  >
                    {submittedPick ? "Update pick" : "Submit pick"}
                  </button>
                  {justSavedWeek === wk && <span className="text-leaf text-sm">Saved.</span>}
                  {stagedPick && stagedPick !== submittedPick && justSavedWeek !== wk && (
                    <span className="text-xs text-chalk/50">Not saved yet — click to confirm.</span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      <div className="text-sm font-bold mb-2">Pick history</div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-chalk/50">
            <th className="py-1 px-2">Week</th>
            <th className="py-1 px-2">Pick</th>
            <th className="py-1 px-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {weekNums.map((wk) => {
            const d = status.detail[wk] || {};
            return (
              <tr key={wk} className="border-t border-turfline">
                <td className="py-1 px-2">{wk}</td>
                <td className="py-1 px-2">
                  {d.pick || "—"}
                  {d.auto && (
                    <span className="text-amber text-xs ml-1" title={d.autoNote}>(auto)</span>
                  )}
                </td>
                <td className="py-1 px-2">
                  {d.result === "win" && <Pill tone="green">Win</Pill>}
                  {d.result === "loss" && <Pill tone="red">Loss</Pill>}
                  {d.result === "nopick" && <Pill tone="red">No pick</Pill>}
                  {d.result === "pending" && <Pill tone="amber">Pending</Pill>}
                  {d.result === "upcoming" && <Pill tone="gray">Upcoming</Pill>}
                  {d.result === "na" && <Pill tone="gray">—</Pill>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
