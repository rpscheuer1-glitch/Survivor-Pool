// Playoff pool rules, shared across pages. Kept separate from poolLogic.js so
// nothing here can change how the regular-season survivor pool behaves.
//
//   * Each round, each entry makes ONE pick: a side against the spread or the
//     over/under on one game. Win (cover) and you advance; lose and you're out.
//   * A round's lines freeze Wednesday 1:00 PM Central before its first game
//     (for the Super Bowl, the Wednesday right before it). Picks open then.
//   * All of a round's picks lock together one hour before its first kickoff,
//     so nobody can wait on Saturday's results to pick a Sunday game. Picks
//     are revealed at that lock.
//   * Every line ends in .5 so nothing pushes: a whole-number spread gets half
//     a point added to the favorite (-3 -> -3.5) and a whole-number total gets
//     half a point added (44 -> 44.5).
//   * No pick at the lock -> the round's biggest favorite (ties: earliest
//     kickoff).
//
// The database enforces the same lock rules (supabase/playoffs.sql); keep the
// two in step.
import { wallTimeToUTC } from "./poolLogic";
import { abbr } from "./teams";

export const MAX_PLAYOFF_ENTRIES = 4;
export const PLAYOFF_ENTRY_FEE = 100;

// Pay links with the amount and a note already filled in. Usernames come from
// Admin > Playoffs; a leading "@" or a pasted profile link is tolerated.
function cleanUsername(raw) {
  return (raw || "").trim().replace(/^https?:\/\/[^/]+\/(u\/|paypalme\/)?/i, "").replace(/^@/, "").replace(/\/.*$/, "");
}

export function venmoPayUrl(username, amount, note) {
  const user = cleanUsername(username);
  if (!user) return null;
  return `https://venmo.com/${encodeURIComponent(user)}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`;
}

export function paypalPayUrl(username, amount) {
  const user = cleanUsername(username);
  if (!user) return null;
  return `https://www.paypal.com/paypalme/${encodeURIComponent(user)}/${amount}`;
}

export const ROUNDS = [
  { round: 1, name: "Wild Card", nflWeek: 19 },
  { round: 2, name: "Divisional", nflWeek: 20 },
  { round: 3, name: "Conference Championships", nflWeek: 21 },
  { round: 4, name: "Super Bowl", nflWeek: 22 },
];

export function roundName(round) {
  return ROUNDS.find((r) => r.round === Number(round))?.name || `Round ${round}`;
}

// --- Lines -----------------------------------------------------------------

function isWhole(n) {
  return Number.isFinite(n) && Math.abs(n % 1) < 1e-9;
}

// Spread is home-relative (negative = home favored), so adding half a point
// to the favorite means moving it half a point further from zero. A pick 'em
// (0) has no favorite and stays as is -- playoff games can't end tied, so it
// can't push either.
export function halfPointSpread(spread) {
  if (spread === null || spread === undefined || spread === "") return null;
  const s = Number(spread);
  if (!Number.isFinite(s)) return null;
  if (s === 0 || !isWhole(s)) return s;
  return s < 0 ? s - 0.5 : s + 0.5;
}

export function halfPointTotal(total) {
  if (total === null || total === undefined || total === "") return null;
  const t = Number(total);
  if (!Number.isFinite(t)) return null;
  return isWhole(t) ? t + 0.5 : t;
}

function signed(n) {
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

// The line a given choice is graded against, as shown to players.
export function choiceLine(game, choice) {
  const s = Number(game.spread);
  if (choice === "home") return signed(s);
  if (choice === "away") return signed(-s);
  return game.total == null ? "—" : `${Number(game.total)}`;
}

export function pickLabel(game, choice) {
  if (!game || !choice) return "";
  if (choice === "home") return `${game.home} ${choiceLine(game, "home")}`;
  if (choice === "away") return `${game.away} ${choiceLine(game, "away")}`;
  const side = choice === "over" ? "Over" : "Under";
  return `${side} ${choiceLine(game, choice)} (${abbr(game.away)} @ ${abbr(game.home)})`;
}

export function shortPickLabel(game, choice) {
  if (!game || !choice) return "—";
  if (choice === "home") return `${abbr(game.home)} ${choiceLine(game, "home")}`;
  if (choice === "away") return `${abbr(game.away)} ${choiceLine(game, "away")}`;
  return `${choice === "over" ? "O" : "U"} ${choiceLine(game, choice)}`;
}

export function matchupLabel(game) {
  return `${game.away} @ ${game.home}`;
}

// --- Lock times ----------------------------------------------------------

// A game's kickoff (noon Central on its date if no kickoff is set).
export function gameKickoff(game) {
  if (!game) return null;
  if (game.kickoff) {
    const k = new Date(game.kickoff);
    if (!isNaN(k.getTime())) return k;
  }
  if (game.game_date) {
    const [y, m, d] = game.game_date.split("-").map(Number);
    return wallTimeToUTC("America/Chicago", y, m, d, 12, 0);
  }
  return null;
}

export function gameStarted(game, now = new Date()) {
  const k = gameKickoff(game);
  return !!k && now.getTime() >= k.getTime();
}

// The Central-time calendar date a game is played on, as YYYY-MM-DD.
function gameDay(game) {
  if (game.game_date) return game.game_date;
  if (!game.kickoff) return null;
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(game.kickoff))
    .forEach((p) => (parts[p.type] = p.value));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Wednesday 1:00 PM Central before the round's first game.
export function linesLockTime(roundGames) {
  const days = (roundGames || []).map(gameDay).filter(Boolean).sort();
  if (days.length === 0) return null;
  const [y, m, d] = days[0].split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const back = ((day.getUTCDay() + 3) % 7) + 1; // days back to the previous Wednesday
  day.setUTCDate(day.getUTCDate() - back);
  return wallTimeToUTC("America/Chicago", day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 13, 0);
}

export function linesLocked(roundGames, now = new Date()) {
  const lock = linesLockTime(roundGames);
  return !!lock && now.getTime() >= lock.getTime();
}

// Every pick in the round locks one hour before the round's first kickoff.
export function roundLockTime(roundGames) {
  const kicks = (roundGames || []).map(gameKickoff).filter(Boolean).map((d) => d.getTime());
  if (kicks.length === 0) return null;
  return new Date(Math.min(...kicks) - 60 * 60 * 1000);
}

export function roundLocked(roundGames, now = new Date()) {
  const lock = roundLockTime(roundGames);
  return !!lock && now.getTime() >= lock.getTime();
}

// Picks can be made or changed between the line lock and the round lock.
// Mirrors the database's playoff_pick_open().
export function picksOpen(roundGames, now = new Date()) {
  return linesLocked(roundGames, now) && !roundLocked(roundGames, now);
}

export function formatCentral(date, opts = {}) {
  if (!date) return "TBD";
  return (
    date.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...opts,
    }) + " CT"
  );
}

// --- Auto-pick and grading ----------------------------------------------

// The favorite an entry with no pick gets: biggest spread, then earliest
// kickoff, then game id.
export function autoPickFor(roundGames) {
  const candidates = (roundGames || []).filter((g) => Number(g.spread) !== 0);
  if (candidates.length === 0) return null;
  const lockMs = (g) => gameKickoff(g)?.getTime() ?? Infinity;
  const sorted = candidates.slice().sort((a, b) => {
    const bySpread = Math.abs(Number(b.spread)) - Math.abs(Number(a.spread));
    if (bySpread !== 0) return bySpread;
    if (lockMs(a) !== lockMs(b)) return lockMs(a) - lockMs(b);
    return String(a.id).localeCompare(String(b.id));
  });
  const game = sorted[0];
  return { game, choice: Number(game.spread) < 0 ? "home" : "away" };
}

export function gameFinal(game) {
  return !!game && game.home_score !== null && game.home_score !== undefined && game.away_score !== null && game.away_score !== undefined;
}

// "win" / "loss" / "push", or null until the game has a final score. A push
// can only happen if a whole-number line slipped through; it advances.
export function gradePick(game, choice) {
  if (!gameFinal(game)) return null;
  const h = Number(game.home_score);
  const a = Number(game.away_score);
  const s = Number(game.spread);
  let margin;
  if (choice === "home") margin = h + s - a;
  else if (choice === "away") margin = a - s - h;
  else if (choice === "over") margin = h + a - Number(game.total);
  else if (choice === "under") margin = Number(game.total) - (h + a);
  else return null;
  if (!Number.isFinite(margin)) return null;
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}

// --- Entry status --------------------------------------------------------

// The round players are picking (or watching) now: the latest round with
// games loaded.
export function currentRound(gamesByRound) {
  const loaded = ROUNDS.map((r) => r.round).filter((r) => (gamesByRound[r] || []).length > 0);
  return loaded.length ? loaded[loaded.length - 1] : 1;
}

// picksByRound: round -> { gameId, choice } for a pick that can be seen,
// { hidden: true } for someone else's pick before the round locks, or
// { voided: true } for a pick whose game the admin deleted.
// gamesByRound: round -> [game, ...].
//
// Returns { eliminated, eliminatedRound, reason, detail: round -> {...} },
// where detail.result is win / push / loss / pending / hidden / nopick /
// invalid / upcoming / na.
export function computePlayoffStatus(picksByRound, gamesByRound, now = new Date()) {
  let eliminated = false;
  let eliminatedRound = null;
  let reason = null;
  const detail = {};

  for (const { round } of ROUNDS) {
    const games = gamesByRound[round] || [];
    if (games.length === 0) continue;
    const stored = picksByRound[round] || null;

    if (eliminated) {
      detail[round] = { result: "na" };
      continue;
    }

    if (stored?.hidden) {
      detail[round] = { result: "hidden", hidden: true };
      continue;
    }

    const game = stored && !stored.voided ? games.find((g) => g.id === stored.gameId) : null;
    if (game) {
      const result = gradePick(game, stored.choice) || "pending";
      detail[round] = { game, choice: stored.choice, result, auto: false };
      if (result === "loss") {
        eliminated = true;
        eliminatedRound = round;
        reason = "Pick lost";
      }
      continue;
    }

    // No pick that counts when the round locks: the biggest favorite.
    const locked = roundLocked(games, now);
    const auto = autoPickFor(games);
    if (auto && locked) {
      const result = gradePick(auto.game, auto.choice) || "pending";
      detail[round] = { game: auto.game, choice: auto.choice, result, auto: true, invalid: !!stored };
      if (result === "loss") {
        eliminated = true;
        eliminatedRound = round;
        reason = "Pick lost (auto-assigned — biggest favorite, no pick submitted)";
      }
      continue;
    }

    if (locked) {
      eliminated = true;
      eliminatedRound = round;
      reason = "No pick submitted";
      detail[round] = { result: "nopick" };
      continue;
    }

    detail[round] = { result: stored ? "invalid" : "upcoming", invalid: !!stored };
  }

  return { eliminated, eliminatedRound, reason, detail };
}

// Groups rows from playoff_games by round, earliest first.
export function groupGamesByRound(gameRows) {
  const gbr = {};
  (gameRows || []).forEach((g) => {
    gbr[g.round] = gbr[g.round] || [];
    gbr[g.round].push(g);
  });
  Object.values(gbr).forEach((list) =>
    list.sort((a, b) => (gameKickoff(a)?.getTime() ?? Infinity) - (gameKickoff(b)?.getTime() ?? Infinity))
  );
  return gbr;
}

// Rows from playoff_revealed_picks -> entry id -> round -> pick, in the shape
// computePlayoffStatus expects.
export function picksFromRevealed(rows) {
  const pbe = {};
  (rows || []).forEach((p) => {
    pbe[p.entry_id] = pbe[p.entry_id] || {};
    pbe[p.entry_id][p.round] = p.voided
      ? { voided: true }
      : p.revealed
      ? { gameId: p.game_id, choice: p.choice }
      : { hidden: true };
  });
  return pbe;
}

// Rows from playoff_picks (your own, or the server's full read) -> the same shape.
export function picksFromRows(rows) {
  const pbe = {};
  (rows || []).forEach((p) => {
    pbe[p.entry_id] = pbe[p.entry_id] || {};
    pbe[p.entry_id][p.round] = p.game_id ? { gameId: p.game_id, choice: p.choice } : { voided: true };
  });
  return pbe;
}
