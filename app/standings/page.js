"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { computeStatus } from "../../lib/poolLogic";
import { abbr } from "../../lib/teams";

function Pill({ tone = "gray", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export default function Standings() {
  const [weekly, setWeekly] = useState([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [aliveCount, setAliveCount] = useState(0);
  const [eliminatedCount, setEliminatedCount] = useState(0);
  const [missedPickCount, setMissedPickCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
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

      const statuses = (entries || []).map((e) => ({
        entry: e,
        status: computeStatus(picksByEntry[e.id] || {}, gamesByWeek, finalByWeek),
      }));

      const weekNums = Object.keys(gamesByWeek).map(Number).sort((a, b) => a - b);

      const weekly = weekNums.map((wk) => {
        // Entries still alive going into this week: never eliminated, or eliminated in this week or later.
        const remainingEntries = statuses.filter(
          (s) => s.status.eliminatedWeek === null || s.status.eliminatedWeek >= wk
        );

        const tally = {};
        let noPick = 0;
        remainingEntries.forEach((s) => {
          const pick = s.status.detail[wk]?.pick;
          if (!pick) {
            noPick += 1;
            return;
          }
          tally[pick] = (tally[pick] || 0) + 1;
        });

        const games = gamesByWeek[wk] || [];
        const rows = Object.entries(tally)
          .map(([team, count]) => {
            const game = games.find((g) => g.home === team || g.away === team);
            let result = "pending";
            if (game?.winner) result = game.winner === team ? "win" : "loss";
            return { team, count, result };
          })
          .sort((a, b) => b.count - a.count);

        return { week: wk, remaining: remainingEntries.length, rows, noPick, isFinal: !!finalByWeek[wk] };
      });

      setWeekly(weekly);
      setTotalEntries((entries || []).length);
      setAliveCount(statuses.filter((s) => !s.status.eliminated).length);
      setEliminatedCount(statuses.filter((s) => s.status.eliminated).length);
      setMissedPickCount(statuses.filter((s) => s.status.reason === "No pick submitted").length);
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-chalk/60">Loading…</p>;
  if (weekly.length === 0) return <p className="text-chalk/60">No games entered yet.</p>;

  const latestWeek = weekly[weekly.length - 1]?.week;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="border border-turfline rounded-lg px-4 py-3">
          <div className="text-xs text-chalk/50 uppercase tracking-wide mb-1">Survivors</div>
          <div className="text-2xl font-black text-leaf">{aliveCount}</div>
          <div className="text-xs text-chalk/40">{totalEntries ? ((aliveCount / totalEntries) * 100).toFixed(1) : "0.0"}%</div>
        </div>
        <div className="border border-turfline rounded-lg px-4 py-3">
          <div className="text-xs text-chalk/50 uppercase tracking-wide mb-1">Eliminated</div>
          <div className="text-2xl font-black text-rust">{eliminatedCount}</div>
          <div className="text-xs text-chalk/40">{totalEntries ? ((eliminatedCount / totalEntries) * 100).toFixed(1) : "0.0"}%</div>
        </div>
        <div className="border border-turfline rounded-lg px-4 py-3">
          <div className="text-xs text-chalk/50 uppercase tracking-wide mb-1">Missed a pick</div>
          <div className="text-2xl font-black text-amber">{missedPickCount}</div>
          <div className="text-xs text-chalk/40">{totalEntries ? ((missedPickCount / totalEntries) * 100).toFixed(1) : "0.0"}%</div>
        </div>
      </div>
      <p className="text-sm text-chalk/60">{totalEntries} total entries in the pool.</p>
      {weekly.map((w) => (
        <details key={w.week} open={w.week === latestWeek} className="border border-turfline rounded-lg">
          <summary className="cursor-pointer px-4 py-3 font-bold flex justify-between items-center flex-wrap gap-2">
            <span>Week {w.week}</span>
            <span className="text-sm font-normal text-chalk/60">
              {w.remaining} entries remaining entering this week
            </span>
          </summary>
          <div className="px-4 pb-4">
            <div className="grid gap-2">
              {w.rows.map((r) => {
                const pct = w.remaining > 0 ? (r.count / w.remaining) * 100 : 0;
                const barColor = r.result === "win" ? "#3FA66C" : r.result === "loss" ? "#D6453A" : "#F2661A";
                return (
                  <div key={r.team} className="flex items-center gap-3 text-sm">
                    <span className="w-11 text-xs font-black text-chalk/60 flex-shrink-0">{abbr(r.team)}</span>
                    <span className="w-40 flex-shrink-0 truncate">{r.team}</span>
                    <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div style={{ width: `${pct}%`, background: barColor }} className="h-full rounded-full" />
                    </div>
                    <span className="w-16 text-right text-xs text-chalk/60 flex-shrink-0">{pct.toFixed(1)}%</span>
                    <span className="w-10 text-right text-xs text-chalk/60 flex-shrink-0">{r.count}</span>
                    <span className="w-20 flex-shrink-0 text-right">
                      {r.result === "win" && <Pill tone="green">Win</Pill>}
                      {r.result === "loss" && <Pill tone="red">Loss</Pill>}
                      {r.result === "pending" && <Pill tone="amber">Pending</Pill>}
                    </span>
                  </div>
                );
              })}
              {w.noPick > 0 && (
                <div className="flex items-center gap-3 text-sm border-t border-turfline pt-2 mt-1">
                  <span className="w-11 flex-shrink-0" />
                  <span className="w-40 flex-shrink-0 text-chalk/60">No pick submitted</span>
                  <div className="flex-1" />
                  <span className="w-16 flex-shrink-0" />
                  <span className="w-10 text-right text-xs text-chalk/60 flex-shrink-0">{w.noPick}</span>
                  <span className="w-20 flex-shrink-0 text-right"><Pill tone="red">Eliminated</Pill></span>
                </div>
              )}
              {w.rows.length === 0 && w.noPick === 0 && (
                <p className="text-chalk/50 text-sm">No picks submitted yet.</p>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
