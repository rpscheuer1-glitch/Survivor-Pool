"use client";
import { useEffect, useState } from "react";
import { pushSupported, isIos, isStandalone, turnOnPush, turnOffPush, resyncPush } from "../lib/pushClient";

const HIDE_KEY = "notif-card-collapsed";

// Dashboard card that gets people to turn on phone notifications for this
// device, or (on iPhone in Safari) explains the Add to Home Screen step
// iPhones require first.
export default function NotificationsCard() {
  const [state, setState] = useState("loading"); // loading | unsupported | ios-install | off | on | denied
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(HIDE_KEY) === "1"); } catch (e) {}
    (async () => {
      if (!pushSupported()) {
        setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") { setState("denied"); return; }
      setState((await resyncPush()) ? "on" : "off");
    })();
  }, []);

  const collapse = (value) => {
    setCollapsed(value);
    try { localStorage.setItem(HIDE_KEY, value ? "1" : "0"); } catch (e) {}
  };

  const turnOn = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await turnOnPush();
      setState(result === "granted" ? "on" : result === "denied" ? "denied" : "off");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    await turnOffPush();
    setState("off");
    setBusy(false);
  };

  if (state === "loading" || state === "unsupported") return null;

  if (state === "on") {
    return (
      <p className="text-xs text-chalk/50 mb-4">
        🔔 Notifications are on for this device.{" "}
        <button className="underline" onClick={turnOff} disabled={busy}>Turn off</button>
      </p>
    );
  }

  if (collapsed) {
    return (
      <p className="text-xs text-chalk/50 mb-4">
        <button className="underline" onClick={() => collapse(false)}>🔔 Get pool notifications on your phone</button>
      </p>
    );
  }

  return (
    <div className="border border-turfline rounded-lg px-4 py-3 mb-4 bg-white/5">
      <div className="font-bold text-sm mb-1">🔔 Get pool notifications on your phone</div>
      {state === "ios-install" && (
        <p className="text-sm text-chalk/70">
          On iPhone, first add this site to your home screen: tap the <b>Share</b> button in Safari, then{" "}
          <b>Add to Home Screen</b>. Open the pool from that new icon, and turn on notifications from this page.
        </p>
      )}
      {state === "off" && (
        <>
          <p className="text-sm text-chalk/70 mb-3">
            Get a heads-up when you still need a pick, if your pick gets auto-assigned, and for pool announcements.
          </p>
          <button className="btn-primary" onClick={turnOn} disabled={busy}>
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
        </>
      )}
      {state === "denied" && (
        <p className="text-sm text-chalk/70">
          Notifications are blocked for this site. To get them, allow notifications for this site in your phone or browser
          settings, then reload this page.
        </p>
      )}
      {error && <p className="text-rust text-sm mt-2">{error}</p>}
      <button className="text-xs text-chalk/50 underline mt-2 block" onClick={() => collapse(true)}>Not now</button>
    </div>
  );
}
