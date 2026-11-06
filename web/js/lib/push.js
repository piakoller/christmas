// Push-Nachrichten: Gerät anmelden/abmelden, Einstellungen pro Ereignis, Ereignisse melden.
import { html, useState, useEffect, useApp, useAction, Alert } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { CONFIG } from "../../config.js";

// Meldet ein Ereignis an die Edge Function "notify", die die Nachrichten verschickt.
// kind: "expert" | "meal" | "suggestion" | "test"
export async function notify(kind, id = null) {
  const { data, error } = await supabase.functions.invoke("notify", { body: { kind, id } });
  if (error) throw new Error("Benachrichtigung konnte nicht verschickt werden");
  return data;
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyToBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(person) {
  if (!CONFIG.vapidPublicKey) throw new Error("Push ist noch nicht eingerichtet (VAPID-Schlüssel fehlt).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Benachrichtigungen wurden nicht erlaubt. Du kannst das in den Einstellungen deines Browsers bzw. Handys ändern.");
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(CONFIG.vapidPublicKey) }));
  const { keys } = sub.toJSON();
  // Falls das Gerät vorher für jemand anderen angemeldet war: alten Eintrag ersetzen
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  check(await supabase.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, person, p256dh: keys.p256dh, auth: keys.auth, user_agent: navigator.userAgent.slice(0, 200),
  }), "Gerät konnte nicht angemeldet werden");
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

// Beim Abmelden: Dieses Gerät soll keine Nachrichten mehr für diese Person bekommen
export async function forgetDeviceOnLogout() {
  try {
    const sub = await currentSubscription();
    if (sub) await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  } catch { /* nicht schlimm */ }
}

const PREFS = [
  { key: "expert", label: "👨‍🏫 Ich werde als Experte für einen Wunsch eingetragen" },
  { key: "meal", label: "🍽️ Mir wird ein Gericht zugeteilt" },
  { key: "suggestion", label: "🤫 Jemand macht einen neuen geheimen Geschenkvorschlag" },
];

export function NotificationSettings() {
  const { me } = useApp();
  const [deviceOn, setDeviceOn] = useState(null); // null = lädt
  const [prefs, setPrefs] = useState({ expert: true, meal: true, suggestion: true });
  const device = useAction();
  const prefAction = useAction();
  const test = useAction();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notification_prefs").select("*").eq("person", me.name).maybeSingle();
      if (data) setPrefs({ expert: data.expert, meal: data.meal, suggestion: data.suggestion });
      if (!pushSupported()) { setDeviceOn(false); return; }
      const sub = await currentSubscription();
      if (!sub) { setDeviceOn(false); return; }
      const { data: row } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
      setDeviceOn(Boolean(row));
    })().catch(() => setDeviceOn(false));
  }, [me.name]);

  const toggleDevice = async (on) => {
    const ok = await device.run(() => (on ? enablePush(me.name) : disablePush()),
      on ? "Benachrichtigungen auf diesem Gerät aktiviert" : "Benachrichtigungen auf diesem Gerät ausgeschaltet");
    if (ok) setDeviceOn(on);
  };

  const togglePref = async (key, value) => {
    const next = { ...prefs, [key]: value };
    const ok = await prefAction.run(async () => {
      check(await supabase.from("notification_prefs").upsert({ person: me.name, ...next }), "Einstellung konnte nicht gespeichert werden");
    });
    if (ok) setPrefs(next);
  };

  let deviceArea;
  if (!pushSupported() && isIOS() && !isStandalone()) {
    deviceArea = html`<${Alert} kind="info">
      <strong>iPhone/iPad:</strong> Benachrichtigungen gehen nur, wenn die App auf dem Home-Bildschirm liegt:
      unten auf <strong>Teilen</strong> (□↑) tippen → <strong>„Zum Home-Bildschirm“</strong> → die App von dort öffnen
      und hier Benachrichtigungen aktivieren.<//>`;
  } else if (!pushSupported()) {
    deviceArea = html`<${Alert} kind="warn">Dieser Browser unterstützt keine Benachrichtigungen.<//>`;
  } else {
    deviceArea = html`
      <label class="check">
        <input type="checkbox" checked=${deviceOn === true} disabled=${deviceOn === null || device.busy}
               onChange=${(e) => toggleDevice(e.target.checked)} />
        <strong>Benachrichtigungen auf diesem Gerät</strong>
      </label>
      ${deviceOn && html`<div><button class="btn small" disabled=${test.busy}
        onClick=${() => test.run(() => notify("test"), "Test-Nachricht verschickt")}>Test-Nachricht schicken</button></div>`}
      <${Alert} kind="error">${device.error || test.error}<//>`;
  }

  return html`
    <div class="card form">
      <h3>🔔 Benachrichtigungen</h3>
      ${deviceArea}
      <div>
        <div style="font-weight:600;margin-bottom:.4rem">Benachrichtige mich, wenn …</div>
        ${PREFS.map((p) => html`<label class="check" style="margin:.35rem 0">
          <input type="checkbox" checked=${prefs[p.key]} disabled=${prefAction.busy}
                 onChange=${(e) => togglePref(p.key, e.target.checked)} />
          ${p.label}
        </label>`)}
        <small>Gilt für alle deine Geräte, auf denen Benachrichtigungen aktiviert sind.</small>
      </div>
      <${Alert} kind="error">${prefAction.error}<//>
    </div>`;
}
