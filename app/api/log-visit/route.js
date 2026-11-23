import { getRequestUser } from "../../../lib/requireAdmin";
import { getServiceClient } from "../../../lib/supabaseAdmin";

// Records the IP + device of a sign-in or site visit in activity_log (see
// supabase/migration_add_activity_log.sql). Called quietly by ActivityLogger;
// any failure (including the table not existing yet) is swallowed so it can
// never affect the person using the site.
export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return Response.json({ ok: false }, { status: 401 });
    const db = getServiceClient();
    if (!db) return Response.json({ ok: false });

    const body = await request.json().catch(() => ({}));
    const event = body?.event === "sign_in" ? "sign_in" : "visit";
    const ip =
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = (request.headers.get("user-agent") || "").slice(0, 300);

    // Don't pile up a "visit" row every time someone reopens the site; one per
    // account + IP every 30 minutes is plenty. Sign-ins are always recorded.
    if (event === "visit") {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      let q = db.from("activity_log").select("id").eq("user_id", user.id).gte("created_at", since).limit(1);
      q = ip ? q.eq("ip", ip) : q.is("ip", null);
      const { data: recent } = await q;
      if (recent && recent.length) return Response.json({ ok: true, skipped: true });
    }

    const { error } = await db.from("activity_log").insert({
      user_id: user.id,
      event,
      ip,
      user_agent: userAgent,
    });
    return Response.json({ ok: !error });
  } catch {
    return Response.json({ ok: false });
  }
}
