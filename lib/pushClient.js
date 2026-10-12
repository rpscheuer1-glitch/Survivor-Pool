"use client";
import { supabase } from "./supabaseClient";

// Browser side of push notifications: feature checks, turning them on/off
// for this device, and keeping the server's copy of the subscription current.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    !!VAPID_PUBLIC_KEY &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac, so also check for a touch screen.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Opened from the home-screen icon rather than a browser tab.
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token || ""}` };
}

async function getRegistration() {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function getCurrentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveSubscription(sub) {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Couldn't save notification settings.");
}

// Must be called from a tap/click -- iPhones only allow the permission prompt then.
export async function turnOnPush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await saveSubscription(sub);
  return "granted";
}

export async function turnOffPush() {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: await authHeaders(),
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

// Re-sends this device's existing subscription for whoever is logged in now,
// so it follows account switches on a shared device and gets re-added if the
// server ever dropped it.
export async function resyncPush() {
  const sub = await getCurrentSubscription();
  if (sub && Notification.permission === "granted") await saveSubscription(sub).catch(() => {});
  return !!sub;
}
