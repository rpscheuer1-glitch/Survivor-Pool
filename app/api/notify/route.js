import { getRequestAdmin } from "../../../lib/requireAdmin";
import { getServiceClient } from "../../../lib/supabaseAdmin";
import { sendPushMessages } from "../../../lib/serverPush";

// Up to a few hundred push sends per call; give it room past the 10s default.
export const maxDuration = 60;

// Admin-only. Posts site banner notices and/or sends push notifications.
// Used by Admin > Announcements and by the lock-in tool (one personal notice
// per person whose pick was auto-assigned).
//
// Body: {
//   notices: [{ userId (null = everyone), title, body }],
//   banner: bool,     // show at the top of the site until dismissed
//   push: bool,       // send to phones that turned notifications on
//   expiresAt: ISO string | null,
// }
export async function POST(request) {
  try {
    const admin = await getRequestAdmin(request);
    if (!admin) return Response.json({ error: "Not authorized." }, { status: 401 });
    const db = getServiceClient();
    if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 500 });

    const { notices, banner, push, expiresAt } = await request.json();
    const valid = (Array.isArray(notices) ? notices : []).filter((n) => n && n.title && n.title.trim());
    if (valid.length === 0) return Response.json({ error: "Missing title." }, { status: 400 });

    const result = {};

    if (banner) {
      const rows = valid.map((n) => ({
        user_id: n.userId || null,
        title: n.title.trim(),
        body: (n.body || "").trim(),
        created_by: admin.id,
        expires_at: expiresAt || null,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("notices").insert(rows.slice(i, i + 500));
        if (error) return Response.json({ error: `Banner not saved: ${error.message}` }, { status: 500 });
      }
      result.bannersPosted = rows.length;
    }

    if (push) {
      result.push = await sendPushMessages(
        db,
        valid.map((n) => ({ userId: n.userId || null, title: n.title.trim(), body: (n.body || "").trim(), url: "/dashboard" }))
      );
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
