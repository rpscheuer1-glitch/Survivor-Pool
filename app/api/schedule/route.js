// Pulls schedule/scores/spreads from nflverse's community-maintained,
// publicly-hosted CSV on GitHub's raw content CDN. Switched to this after
// ESPN's own endpoint started reliably blocking requests from Vercel's
// servers (confirmed via direct testing -- the same request worked fine
// from a regular browser but failed 100% of the time from our server,
// across every date format we tried). GitHub's CDN is a fundamentally
// different, far more robust kind of infrastructure for this than a sports
// site's own undocumented API, and isn't something we've seen blocked.
//
// Nice side effect: this data already includes real scores AND spreads in
// the exact "negative = home favored" convention this app already uses, so
// there's no odds-provider parsing/sign-guessing needed like ESPN required.
// It's also indexed by season+week directly, so there's no more need to
// guess date ranges at all.

const NFLVERSE_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

// nflverse's own team abbreviation convention -- confirmed directly against
// live data. Only one differs from this app's own display abbreviations:
// nflverse uses "LA" for the Rams (this app's own chips use "LAR").
const ABBR_TO_NAME = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys",
  DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers",
  LA: "Los Angeles Rams", MIA: "Miami Dolphins", MIN: "Minnesota Vikings",
  NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers",
  SF: "San Francisco 49ers", SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = Number(searchParams.get("week"));
  const season = Number(searchParams.get("season"));

  if (!week || !season) {
    return Response.json({ error: "Missing week or season" }, { status: 400 });
  }

  try {
    const res = await fetch(NFLVERSE_GAMES_URL, { cache: "no-store" });
    if (!res.ok) {
      return Response.json({ error: `Couldn't fetch nflverse data: ${res.status}` }, { status: 502 });
    }
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const header = lines[0].split(",");
    const col = (name) => header.indexOf(name);

    const seasonIdx = col("season");
    const typeIdx = col("game_type");
    const weekIdx = col("week");
    const gamedayIdx = col("gameday");
    const awayIdx = col("away_team");
    const awayScoreIdx = col("away_score");
    const homeIdx = col("home_team");
    const homeScoreIdx = col("home_score");
    const spreadIdx = col("spread_line");

    const games = lines
      .slice(1)
      .map((line) => line.split(","))
      .filter(
        (cols) =>
          Number(cols[seasonIdx]) === season &&
          cols[typeIdx] === "REG" &&
          Number(cols[weekIdx]) === week
      )
      .map((cols) => {
        const awayAbbr = cols[awayIdx];
        const homeAbbr = cols[homeIdx];
        const gameDate = cols[gamedayIdx]; // already YYYY-MM-DD, already the correct calendar day
        const homeScoreStr = cols[homeScoreIdx];
        const awayScoreStr = cols[awayScoreIdx];
        const spreadStr = cols[spreadIdx];

        const home = ABBR_TO_NAME[homeAbbr] || homeAbbr;
        const away = ABBR_TO_NAME[awayAbbr] || awayAbbr;
        const completed = homeScoreStr !== "" && awayScoreStr !== "" && homeScoreStr != null && awayScoreStr != null;
        let winner = null;
        if (completed) {
          const hs = Number(homeScoreStr);
          const as = Number(awayScoreStr);
          if (hs !== as) winner = hs > as ? home : away;
        }
        const spread = spreadStr !== "" && spreadStr != null ? Number(spreadStr) : null;

        return {
          home,
          away,
          date: gameDate,
          game_date: gameDate,
          completed,
          winner,
          spread,
        };
      })
      .filter((g) => g.home && g.away);

    return Response.json({ games });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
