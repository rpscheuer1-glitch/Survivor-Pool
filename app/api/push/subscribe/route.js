import { getRequestUser } from "../../../../lib/requireAdmin";
import { getServiceClient } from "../../../../lib/supabaseAdmin";

// Saves (POST) or removes (DELETE) this device's push subscription for the
// logged-in user. Done server-side so a shared phone/browser that switches
// accounts simply gets re-pointed at whoever turned notifications on last.
export async function POST(request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Not logged in." }, { status: 401 });
  const db = getServiceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 500 });

  const { subscription } = await request.json();
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const { error } = await db.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
    },
    { onConflict: "endpoint" }
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Not logged in." }, { status: 401 });
  const db = getServiceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 500 });

  const { endpoint } = await request.json();
  if (!endpoint) return Response.json({ error: "Missing endpoint." }, { status: 400 });
  await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user.id);
  return Response.json({ ok: true });
}
