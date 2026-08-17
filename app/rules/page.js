export default function RulesPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-black uppercase tracking-wide mb-6">Pool Rules</h1>

      <ol className="grid gap-5 text-sm leading-relaxed">
        <li>
          <span className="font-bold text-chalk">1.</span> $100 per entry, up to 5 entries per person.
        </li>
        <li>
          <span className="font-bold text-chalk">2.</span> Pick one team to win straight up each week. You can pick
          the same team as many times as you'd like over the course of the season.
        </li>
        <li>
          <span className="font-bold text-chalk">3.</span> Starting in Week 6, any game with a spread of 10 or more
          is off the board — you can't pick either team in that game.
        </li>
        <li>
          <span className="font-bold text-chalk">4.</span> Starting in Week 10, any game with a spread of 7 or more
          is off the board.
        </li>
        <li>
          <span className="font-bold text-chalk">5.</span> If you forget to make a pick in any week, you'll
          automatically get the same team you had the previous week.
          <ol className="grid gap-2 mt-2 ml-5 text-chalk/80">
            <li>
              <span className="font-bold">5a.</span> If that team happens to play on Thursday that week, you'll
              instead get the team favored by the most points that week.
            </li>
            <li>
              <span className="font-bold">5b.</span> If you forget to make a pick in Week 1 specifically (it
              happens), you'll get the team favored by the most points that week.
            </li>
          </ol>
        </li>
        <li>
          <span className="font-bold text-chalk">6.</span> Once the pool is down to the final 3 entries, and only
          then, the pool can be split — but only if all 3 agree. If even one person doesn't want to split, the pool
          continues on as normal.
        </li>
        <li>
          <span className="font-bold text-chalk">7.</span> The last 1–3 entries standing at the end of the pool
          split the pot.
        </li>
      </ol>
    </div>
  );
}
