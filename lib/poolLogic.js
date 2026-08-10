// Core survivor-pool rules, shared across pages.
export const MAX_ENTRIES_PER_ACCOUNT = 5;

// Games with a spread of 10+ are excluded starting week 6;
// games with a spread of 7+ are excluded starting week 10.
// Spread is stored signed relative to the home team (negative = home favored,
// positive = home underdog) -- eligibility only cares about magnitude.
export function ineligible(spread, week) {
  const s = Math.abs(Number(spread));
  if (week >= 10) return s >= 7;
  if (week >= 6) return s >= 10;
  return false;
}

// Derives which team is favored from the signed spread.
export function favoriteTeam(game) {
  const s = Number(game.spread);
  if (s < 0) return game.home;
  if (s > 0) return game.away;
  return null; // pick 'em
}

export function spreadLabel(game) {
  const s = Number(game.spread);
  if (!s) return "Pick 'em";
  const fav = favoriteTeam(game);
  return `${fav} favored by ${Math.abs(s)}`;
}

export function ruleLabel(week) {
  if (week >= 10) return "Games with a spread of 7+ are excluded this week.";
  if (week >= 6) return "Games with a spread of 10+ are excluded this week.";
  return "All games are in play this week.";
}

// --- Pick locking -------------------------------------------------------
// Wed/Thu/Fri games lock at 6:00 PM Central Time on the day of the game.
// Sat/Sun/Mon games all lock together at 3:00 PM Eastern on that week's Saturday.
// Only the calendar date of each game is needed — not an exact kickoff time.

function getZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = {};
  fmt.formatToParts(date).forEach((p) => (parts[p.type] = p.value));
  return parts;
}

// Converts a wall-clock date/time in the given IANA time zone into the
// correct UTC instant, automatically handling standard/daylight time
// (both US Eastern and Central only ever use whole-hour offsets, so one
// correction pass is exact).
export function wallTimeToUTC(timeZone, year, month, day, hour, minute) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = getZonedParts(guess, timeZone);
  const gotMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const wantedMinutes = hour * 60 + minute;
  const diff = wantedMinutes - gotMinutes;
  return new Date(guess.getTime() + diff * 60000);
}

// Wed/Thu/Fri games always lock 6:00 PM Central, same day. Sat/Sun/Mon games
// all lock together at whatever day/time is configured for that week
// (defaulting to Sunday 10:00 AM Central) -- read off game.weekend_lock_day /
// game.weekend_lock_time, which callers attach from the weeks table before
// passing games in here. This keeps the lock math itself simple even though
// the deadline is now configurable per week (e.g. a later Week 1 deadline).
export function computeLockTime(game) {
  if (!game.game_date) return null;
  const [y, m, d] = game.game_date.split("-").map(Number);
  const dateUTC = new Date(Date.UTC(y, m - 1, d));
  const weekday = dateUTC.getUTCDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

  if (weekday === 3 || weekday === 4 || weekday === 5) {
    // Wed / Thu / Fri -> 6:00 PM Central, same day
    return wallTimeToUTC("America/Chicago", y, m, d, 18, 0);
  }

  // Sat / Sun / Mon (and any odd case) -> first find that week's Saturday...
  const dayOffset = { 6: 0, 0: 1, 1: 2 }[weekday] ?? 0; // Sat:0, Sun:1, Mon:2
  const satHolder = new Date(Date.UTC(y, m - 1, d));
  satHolder.setUTCDate(satHolder.getUTCDate() - dayOffset);

  // ...then shift to Sunday of that same cluster if that's what's configured.
  const lockDay = game.weekend_lock_day === "saturday" ? "saturday" : "sunday";
  if (lockDay === "sunday") {
    satHolder.setUTCDate(satHolder.getUTCDate() + 1);
  }

  const [lockHour, lockMinute] = (game.weekend_lock_time || "10:00").split(":").map(Number);
  return wallTimeToUTC(
    "America/Chicago",
    satHolder.getUTCFullYear(),
    satHolder.getUTCMonth() + 1,
    satHolder.getUTCDate(),
    lockHour,
    lockMinute || 0
  );
}

export function isLocked(game, now = new Date()) {
  const lock = computeLockTime(game);
  if (!lock) return false;
  return now.getTime() >= lock.getTime();
}

export function formatGameDate(game) {
  if (!game.game_date) return "Date TBD";
  const [y, m, d] = game.game_date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
}

// Shows the actual lock date/time (in Central) rather than relative wording
// like "today" — relative phrasing reads as "today" the day you're looking
// at it, not the day of the game, which is exactly the confusion to avoid.
export function formatLockLabel(game) {
  const lock = computeLockTime(game);
  if (!lock) return "Lock time unknown — no date set yet";
  const label = lock.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Locks ${label} CT`;
}

// Checks whether every eligible game in a week has passed its lock time —
// i.e. the pick deadline for that week has genuinely passed. Used to gate
// the "lock in missing picks" admin action.
export function weekFullyLocked(week, gamesByWeek, now = new Date()) {
  const games = (gamesByWeek[week] || []).filter((g) => !ineligible(g.spread, week));
  if (games.length === 0) return false;
  return games.every((g) => isLocked(g, now));
}

// Given a week, the entry's last effective pick (team), and that week's
// games, works out what an entry with no submitted pick should get:
//   1. Carry forward last week's team, IF it's playing in an eligible game
//      this week AND that game shares the week's latest lock time (i.e. it
//      wasn't an early Wed/Thu/Fri game already decided by the deadline).
//   2. Otherwise, the biggest favorite among this week's eligible games.
//   3. Otherwise null (no fallback available).
export function computeFallbackPick(week, lastEffectivePick, gamesByWeek) {
  const games = gamesByWeek[week] || [];
  const eligibleGames = games.filter((g) => !ineligible(g.spread, week));
  const lockTimes = eligibleGames.map((g) => computeLockTime(g)).filter(Boolean);
  const maxLock = lockTimes.length ? Math.max(...lockTimes.map((d) => d.getTime())) : null;

  let candidateGame = null;
  if (lastEffectivePick) {
    candidateGame = eligibleGames.find((g) => g.home === lastEffectivePick || g.away === lastEffectivePick) || null;
    if (candidateGame) {
      const lock = computeLockTime(candidateGame);
      if (!lock || maxLock === null || lock.getTime() !== maxLock) {
        candidateGame = null; // that game already locked earlier in the week -- can't carry forward
      }
    }
  }

  if (candidateGame) {
    return { team: lastEffectivePick, autoNote: "carried over from last week's pick" };
  }

  const withFavorite = eligibleGames
    .map((g) => ({ game: g, favorite: favoriteTeam(g), mag: Math.abs(Number(g.spread)) }))
    .filter((x) => x.favorite && x.mag > 0);
  if (withFavorite.length > 0) {
    const biggest = withFavorite.reduce((a, b) => (b.mag > a.mag ? b : a));
    return { team: biggest.favorite, autoNote: "biggest favorite (no pick submitted)" };
  }

  return null;
}

const LOCKED_IN_NOTE = "Automatically assigned when picks were locked in for the week";

// Accepts either a plain team-name string (legacy shape) or a
// { team, auto } object (current shape, distinguishing real picks from
// ones the "lock in missing picks" admin action wrote in).
function normalizePick(raw) {
  if (!raw) return { team: null, auto: false };
  if (typeof raw === "string") return { team: raw, auto: false };
  return { team: raw.team || null, auto: !!raw.auto };
}

// Derives which week should be "current" purely from today's date and
// whichever weeks have games loaded — no manual setting to forget. A week's
// window ends (and the next one begins) at the Tuesday following its last
// loaded game, matching how the NFL itself structures weeks (Tue-Mon). If
// the calendar has rolled past every week that's been loaded so far, it
// just stays on the last one rather than jumping to an empty week.
export function computeAutoCurrentWeek(gamesByWeek, now = new Date()) {
  const weekNums = Object.keys(gamesByWeek).map(Number).sort((a, b) => a - b);
  if (weekNums.length === 0) return 1;

  const nowUTCDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const wk of weekNums) {
    const dates = (gamesByWeek[wk] || [])
      .map((g) => g.game_date)
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return wk; // can't tell when this week ends -- treat it as current

    const [y, m, d] = dates[dates.length - 1].split("-").map(Number);
    const lastDate = new Date(Date.UTC(y, m - 1, d));
    const weekday = lastDate.getUTCDay(); // 0=Sun ... 6=Sat
    const daysUntilNextTuesday = ((2 - weekday + 7) % 7) || 7;
    const rolloverDate = new Date(lastDate);
    rolloverDate.setUTCDate(rolloverDate.getUTCDate() + daysUntilNextTuesday);

    if (nowUTCDateOnly.getTime() < rolloverDate.getTime()) {
      return wk; // haven't rolled past this week's Tuesday yet
    }
    // otherwise this week is done -- keep checking the next loaded week
  }

  return weekNums[weekNums.length - 1]; // rolled past everything loaded so far
}

// Given one entry's picks (map: week -> team, or week -> {team, auto}),
// all games (map: week -> [game,...]), and which weeks are marked final
// (map: week -> bool), derive alive/eliminated status.
//
// If no pick was submitted for a finalized week and nothing was already
// locked in ahead of time (see computeFallbackPick above), the entry is
// eliminated for "no pick submitted."
export function computeStatus(picksByWeek, gamesByWeek, finalByWeek) {
  const weekNums = Object.keys(gamesByWeek)
    .map(Number)
    .sort((a, b) => a - b);

  let eliminated = false;
  let eliminatedWeek = null;
  let reason = null;
  const detail = {};
  let lastEffectivePick = null;

  for (const wk of weekNums) {
    const games = gamesByWeek[wk] || [];
    const stored = normalizePick(picksByWeek[wk]);
    const manualPick = stored.team;
    const isFinal = !!finalByWeek[wk];

    if (eliminated) {
      detail[wk] = { pick: manualPick, result: "na" };
      continue;
    }

    if (!isFinal) {
      detail[wk] = {
        pick: manualPick,
        result: manualPick ? "pending" : "upcoming",
        auto: stored.auto,
        autoNote: stored.auto ? LOCKED_IN_NOTE : null,
      };
      if (manualPick) lastEffectivePick = manualPick;
      continue;
    }

    let effectivePick = manualPick;
    let auto = stored.auto;
    let autoNote = stored.auto ? LOCKED_IN_NOTE : null;

    if (!effectivePick) {
      const fallback = computeFallbackPick(wk, lastEffectivePick, gamesByWeek);
      if (fallback) {
        effectivePick = fallback.team;
        auto = true;
        autoNote = fallback.autoNote;
      }
    }

    if (!effectivePick) {
      eliminated = true;
      eliminatedWeek = wk;
      reason = "No pick submitted";
      detail[wk] = { pick: null, result: "nopick" };
      continue;
    }

    const game = games.find((g) => g.home === effectivePick || g.away === effectivePick);
    if (!game || !game.winner) {
      detail[wk] = { pick: effectivePick, result: "pending", auto, autoNote };
      lastEffectivePick = effectivePick;
      continue;
    }

    if (game.winner === effectivePick) {
      detail[wk] = { pick: effectivePick, result: "win", auto, autoNote };
      lastEffectivePick = effectivePick;
    } else {
      eliminated = true;
      eliminatedWeek = wk;
      reason = auto ? `Pick lost (auto-assigned — ${autoNote})` : "Pick lost";
      detail[wk] = { pick: effectivePick, result: "loss", auto, autoNote };
    }
  }

  return { eliminated, eliminatedWeek, reason, detail };
}
