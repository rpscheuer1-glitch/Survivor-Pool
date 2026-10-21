export default function PlayoffRulesPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-black uppercase tracking-wide mb-6">Playoff Pool Rules</h1>

      <ol className="grid gap-5 text-sm leading-relaxed">
        <li>
          <span className="font-bold text-chalk">1.</span> $100 per entry, up to 4 entries per person. Playoff entries
          are separate from your regular-season entries.
        </li>
        <li>
          <span className="font-bold text-chalk">2.</span> Each round, each entry makes one pick: either one team
          against the spread, or the over or the under on one game's total points.
        </li>
        <li>
          <span className="font-bold text-chalk">3.</span> If your pick wins, you move on to the next round. If it
          loses, that entry is out.
        </li>
        <li>
          <span className="font-bold text-chalk">4.</span> Lines lock Wednesday at 1:00 PM Central before each round
          (for the Super Bowl, the Wednesday right before the game). Picks open once the lines lock, and the lines
          don't change after that, no matter how they move.
        </li>
        <li>
          <span className="font-bold text-chalk">5.</span> All picks for a round lock one hour before that round's
          first game. You can't wait to see Saturday's results and then pick a Sunday game.
        </li>
        <li>
          <span className="font-bold text-chalk">6.</span> Every line ends in a half point, so there are no ties.
          When a line comes out as a whole number, the favorite and the total each get half a point added: -3
          becomes -3.5, and a total of 44 becomes 44.5.
        </li>
        <li>
          <span className="font-bold text-chalk">7.</span> If you don't have a pick in when picks lock, you get the
          favorite with the biggest spread that round (if two are tied, the one that kicks off first).
        </li>
        <li>
          <span className="font-bold text-chalk">8.</span> Picks stay hidden from everyone, admins included, until
          that round's picks lock.
        </li>
        <li>
          <span className="font-bold text-chalk">9.</span> No tiebreaker: everyone still alive after the Super Bowl
          splits the pot.
        </li>
      </ol>
    </div>
  );
}
