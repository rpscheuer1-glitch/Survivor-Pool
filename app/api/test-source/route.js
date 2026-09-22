// Diagnostic only -- not used anywhere else in the app. Checks whether
// Vercel's servers can actually reach a few candidate data sources, before
// investing time building a real integration around any of them. Visit this
// route directly in a browser to see the results as JSON.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const TARGETS = [
  { name: "ESPN (known broken, for comparison)", url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260928" },
  { name: "TheSportsDB (free public API, no signup)", url: "https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4391&s=2026-2027" },
  { name: "NFL.com (plain site, not an API)", url: "https://www.nfl.com/schedules/2026/reg1/" },
];

export async function GET() {
  const results = await Promise.all(
    TARGETS.map(async (t) => {
      try {
        const res = await fetch(t.url, { cache: "no-store", headers: HEADERS });
        const bodySnippet = (await res.text()).slice(0, 200);
        return { name: t.name, status: res.status, ok: res.ok, bodySnippet };
      } catch (e) {
        return { name: t.name, error: e.message };
      }
    })
  );
  return Response.json({ results });
}
