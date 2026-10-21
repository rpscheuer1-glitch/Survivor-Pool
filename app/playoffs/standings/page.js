"use client";
import { useEffect, useState } from "react";
import { fetchAllRows } from "../../../lib/supabaseClient";
import {
  ROUNDS,
  roundName,
  pickLabel,
  linesLocked,
  computePlayoffStatus,
  groupGamesByRound,
  picksFromRevealed,
} from "../../../lib/playoffLogic";

function Pill({ tone = "gray", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export default function PlayoffStandings() {
  const [rounds, setRounds] = useState([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [aliveCount, setAliveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Names only, and no picks until the round's picks lock -- the
      // database enforces this.
      const entries = await fetchAllRows("playoff_public_entries", "*", "id");
      const gameRows = await fetchAllRows("playoff_games", "*", "id");
      const pickRows = await fetchAllRows("playoff_revealed_picks", "*", "id");
      const now = new Date();

      const gamesByRound = groupGamesByRound(gameRows);
      const picksByEntry = picksFromRevealed(pickRows);
      const statuses = entries.map((e) => ({
        entry: e,
        status: computePlayoffStatus(picksByEntry[e.id] || {}, gamesByRound, now),
      }));

      const built = ROUNDS.map(({ round }) => round)
        .filter((r) => (gamesByRound[r] || []).length > 0)
        .map((r) => {
          const games = gamesByRound[r];
          const remaining = statuses.filter((s) => s.status.eliminatedRound === null || s.status.eliminatedRound >= r);

          // Tally of revealed picks (including auto-assigned ones) by pick.
          const tally = {};
          remaining.forEach((s) => {
            const d = s.status.detail[r];
            if (!d?.game) return;
            const key = `${d.game.id}:${d.choice}`;
            tally[key] = tally[key] || { label: pickLabel(d.game, d.choice), count: 0, result: d.result };
            tally[key].count += 1;
          });

          const entryPicks = remaining
            .map((s) => {
              const d = s.status.detail[r] || {};
              return {
                label: s.entry.label,
                pick: d.game ? pickLabel(d.game, d.choice) : null,
                auto: !!d.auto,
                result: d.result,
              };
            })
            .sort((a, b) => (a.label || "").localeCompare(b.label || ""));

          return {
            round: r,
            remaining: remaining.length,
            rows: Object.values(tally).sort((a, b) => b.count - a.count),
            entryPicks,
            linesLocked: linesLocked(games, now),
          };
        });

      setRounds(built);
      setTotalEntries(entries.length);
      setAliveCount(statuses.filter((s) => !s.status.eliminated).length);
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-chalk/60">Loading…</p>;
  if (rounds.length === 0) return <p className="text-chalk/60">No playoff games entered yet.</p>;

  const latest = rounds[rounds.length - 1].round;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-turfline rounded-lg px-4 py-3">
          <div className="text-xs text-chalk/50 uppercase tracking-wide mb-1">Still alive</div>
          <div className="text-2xl font-black text-leaf">{aliveCount}</div>
        </div>
        <div className="border border-turfline rounded-lg px-4 py-3">
          <div className="text-xs text-chalk/50 uppercase tracking-wide mb-1">Out</div>
          <div className="text-2xl font-black text-rust">{totalEntries - aliveCount}</div>
        </div>
      </div>
      <p className="text-sm text-chalk/60">{totalEntries} total playoff entries.</p>
      {rounds.slice().reverse().map((r) => (
        <RoundCard key={r.round} r={r} isOpenByDefault={r.round === latest} />
      ))}
    </div>
  );
}

function RoundCard({ r, isOpenByDefault }) {
  const [showIndividual, setShowIndividual] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = r.entryPicks.filter((e) => !search || (e.label || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <details open={isOpenByDefault} className="border border-turfline rounded-lg">
      <summary className="cursor-pointer px-4 py-3 font-bold flex justify-between items-center flex-wrap gap-2">
        <span>{roundName(r.round)}</span>
        <span className="text-sm font-normal text-chalk/60">{r.remaining} entries alive going in</span>
      </summary>
      <div className="px-4 pb-4">
        <div className="grid gap-2 mb-4">
          {r.rows.map((row) => {
            const pct = r.remaining > 0 ? (row.count / r.remaining) * 100 : 0;
            const barColor = row.result === "win" || row.result === "push" ? "#3FA66C" : row.result === "loss" ? "#D6453A" : "#F2661A";
            return (
              <div key={row.label} className="flex items-center gap-3 text-sm">
                <span className="w-56 flex-shrink-0 truncate">{row.label}</span>
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div style={{ width: `${pct}%`, background: barColor }} className="h-full rounded-full" />
                </div>
                <span className="w-10 text-right text-xs text-chalk/60 flex-shrink-0">{row.count}</span>
                <span className="w-20 flex-shrink-0 text-right">
                  {(row.result === "win" || row.result === "push") && <Pill tone="green">Win</Pill>}
                  {row.result === "loss" && <Pill tone="red">Loss</Pill>}
                  {row.result === "pending" && <Pill tone="amber">Pending</Pill>}
                </span>
              </div>
            );
          })}
          {r.rows.length === 0 && (
            <p className="text-chalk/50 text-sm">
              {!r.linesLocked ? "Lines aren't locked yet." : "Picks appear here once the round's picks lock."}
            </p>
          )}
        </div>

        <button className="btn-ghost text-xs" onClick={() => setShowIndividual((s) => !s)}>
          {showIndividual ? "Hide individual picks" : "Show individual picks"}
        </button>

        {showIndividual && (
          <div className="mt-3">
            <input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm mb-3"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-chalk/50">
                    <th className="py-1 px-2">Entry</th>
                    <th className="py-1 px-2">Pick</th>
                    <th className="py-1 px-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, i) => (
                    <tr key={i} className="border-t border-turfline">
                      <td className="py-2 px-2 font-bold">{e.label}</td>
                      <td className="py-2 px-2">
                        {e.pick ? (
                          <>
                            {e.pick}
                            {e.auto && <span className="text-amber text-xs ml-1" title="No pick submitted; biggest favorite">(auto)</span>}
                          </>
                        ) : e.result === "hidden" ? (
                          <span className="text-chalk/50 italic text-xs">Hidden until picks lock</span>
                        ) : (
                          <span className="text-chalk/50">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {(e.result === "win" || e.result === "push") && <Pill tone="green">Win</Pill>}
                        {e.result === "loss" && <Pill tone="red">Loss</Pill>}
                        {e.result === "pending" && <Pill tone="amber">Pending</Pill>}
                        {e.result === "hidden" && <Pill tone="gray">Locked soon</Pill>}
                        {e.result === "nopick" && <Pill tone="red">No pick</Pill>}
                        {(e.result === "upcoming" || e.result === "invalid") && <Pill tone="gray">Not shown yet</Pill>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-chalk/50">No matches.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
