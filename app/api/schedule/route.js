// Server-side route (runs on the server, not the browser) so there's no CORS
// issue calling ESPN's public scoreboard feed. Queries by an explicit date
// range rather than week/year — the week/year params on this endpoint don't
// reliably return the right season this far ahead of kickoff, but a concrete
// date range does. Only returns matchups + date — no odds/spread data.

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start"); // YYYY-MM-DD
  const days = Number(searchParams.get("days") || 7);

  if (!start) {
    return Response.json({ error: "Missing start date" }, { status: 400 });
  }

  try {
    const startDate = new Date(start + "T00:00:00Z");
    if (Number.isNaN(startDate.getTime())) {
      return Response.json({ error: "Invalid start date" }, { status: 400 });
    }
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + days - 1);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const datesParam = `${fmt(startDate)}-${fmt(endDate)}`;

    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${datesParam}&limit=100`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return Response.json({ error: `ESPN returned ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const games = (json.events || [])
      .map((event) => {
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];
        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");
        const rawDate = comp?.date || event.date || "";
        return {
          home: home?.team?.displayName || "",
          away: away?.team?.displayName || "",
          date: rawDate,
          game_date: rawDate ? toEasternDateString(rawDate) : null,
        };
      })
      .filter((g) => g.home && g.away);

    return Response.json({ games });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
