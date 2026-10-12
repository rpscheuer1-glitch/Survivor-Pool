import webpush from "web-push";
import { fetchAllRows } from "./supabaseClient";

// SERVER-SIDE ONLY. Sends phone/browser push notifications to everyone who
// turned them on (push_subscriptions). Shared by the admin Announcements tab,
// the lock-in tool's "your pick was auto-assigned" notices, and the reminder
// cron, so the sending logic only lives in one place.

export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

// messages: [{ userId (null = everyone), title, body, url }]
// db: the service-role client (push_subscriptions is server-only).
export async function sendPushMessages(db, messages) {
  if (!pushConfigured()) {
    return { error: "Push notifications aren't configured yet — set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." };
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || `mailto:${process.env.GMAIL_USER || "admin@example.com"}`,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const subs = await fetchAllRows("push_subscriptions", "*", "created_at", db);
  const subsByUser = {};
  subs.forEach((s) => {
    subsByUser[s.user_id] = subsByUser[s.user_id] || [];
    subsByUser[s.user_id].push(s);
  });

  const jobs = [];
  for (const m of messages) {
    const targets = m.userId ? subsByUser[m.userId] || [] : subs;
    const payload = JSON.stringify({ title: m.title, body: m.body || "", url: m.url || "/dashboard" });
    targets.forEach((s) => jobs.push({ sub: s, payload }));
  }

  let sent = 0;
  const expired = [];
  const errors = [];
  // A few hundred sends finish in seconds this way without opening hundreds
  // of connections at once.
  const concurrency = 25;
  for (let i = 0; i < jobs.length; i += concurrency) {
    await Promise.all(
      jobs.slice(i, i + concurrency).map(async ({ sub, payload }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 }
          );
          sent += 1;
        } catch (e) {
          // 404/410 = the person uninstalled, cleared site data, or turned
          // notifications off. That subscription will never work again.
          if (e.statusCode === 404 || e.statusCode === 410) expired.push(sub.id);
          else errors.push(e.message);
        }
      })
    );
  }

  for (let i = 0; i < expired.length; i += 100) {
    await db.from("push_subscriptions").delete().in("id", expired.slice(i, i + 100));
  }

  return { sent, devices: jobs.length, removed: expired.length, errors: errors.slice(0, 5) };
}
