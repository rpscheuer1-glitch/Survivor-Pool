// Server-side route (runs on the server, not the browser) so there's no CORS
// issue calling ESPN's public scoreboard feed. Only returns matchups + date —
// no odds/spread data unless ESPN has posted a line yet.

// ESPN returns game times in UTC. Late-night games (Sunday/Monday Night
// Football, ~8:20pm Eastern) fall past midnight UTC, so naively slicing the
// UTC date pushes them to the next calendar day (Sunday becomes Monday,
// Monday becomes Tuesday). NFL scheduling is conventionally referenced in US
// Eastern time, so we convert to that calendar date instead.
function toEasternDateString(isoString) {
  const d = new Date(isoString);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // en-CA locale conveniently formats as YYYY-MM-DD
}

const ESPN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function mapEvent(event) {
  const comp = event.competitions?.[0];
  const competitors = comp?.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  const rawDate = comp?.date || event.date || "";
  const completed = !!comp?.status?.type?.completed;
  const winnerCompetitor = completed ? competitors.find((c) => c.winner === true) : null;

  // Odds, if ESPN has posted a line yet (usually only within a week or so of
  // kickoff). We don't trust the raw sign of odds.spread -- instead we derive
  // magnitude and figure out which side is favored from the boolean flags,
  // then convert to our own convention: negative = home favored.
  const odds = comp?.odds?.[0];
  let spread = null;
  if (odds && odds.spread != null) {
    const magnitude = Math.abs(Number(odds.spread));
    const homeFavored = !!odds.homeTeamOdds?.favorite;
    const awayFavored = !!odds.awayTeamOdds?.favorite;
    if (magnitude > 0 && (homeFavored || awayFavored)) {
      spread = homeFavored ? -magnitude : magnitude;
    } else if (magnitude === 0) {
      spread = 0; // pick 'em
    }
  }

  return {
    id: event.id,
    home: home?.team?.displayName || "",
    away: away?.team?.displayName || "",
    date: rawDate,
    game_date: rawDate ? toEasternDateString(rawDate) : null,
    completed,
    winner: winnerCompetitor?.team?.displayName || null,
    spread, // null if ESPN doesn't have a line posted yet
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start"); // YYYY-MM-DD
  const days = Number(searchParams.get("days") || 7);

  if (!start) {
    return Response.json({ error: "Missing start date" }, { status: 400 });
  }

  const startDate = new Date(start + "T00:00:00Z");
  if (Number.isNaN(startDate.getTime())) {
    return Response.json({ error: "Invalid start date" }, { status: 400 });
  }

  // ESPN's multi-day "dates=RANGE" format has intermittently returned server
  // errors even for valid, well-formed ranges, while single-day queries keep
  // working fine. Querying one day at a time and merging the results avoids
  // relying on that flaky range format at all.
  const dayStrings = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    dayStrings.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }

  const results = await Promise.all(
    dayStrings.map(async (dayStr) => {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dayStr}&limit=100`;
        const res = await fetch(url, { cache: "no-store", headers: ESPN_HEADERS });
        if (!res.ok) return { dayStr, error: `status ${res.status}` };
        const json = await res.json();
        return { dayStr, events: json.events || [] };
      } catch (e) {
        return { dayStr, error: e.message };
      }
    })
  );

  const failedDays = results.filter((r) => r.error).map((r) => r.dayStr);
  const allEvents = results.flatMap((r) => r.events || []);

  const seen = new Set();
  const uniqueEvents = allEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const games = uniqueEvents.map(mapEvent).filter((g) => g.home && g.away);

  if (games.length === 0 && failedDays.length === dayStrings.length) {
    return Response.json(
      { error: `ESPN failed for every date in range (${dayStrings.join(", ")})` },
      { status: 502 }
    );
  }

  return Response.json({
    games,
    ...(failedDays.length > 0 ? { partialFailureDays: failedDays } : {}),
  });
}
