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
  { key: "expert", label: "👨‍🏫 Ich bin Experte für einen Wunsch" },
  { key: "meal", label: "🍽️ Mir wird ein Gericht zugeteilt" },
  { key: "suggestion", label: "🤫 Neue geheime Geschenkidee" },
  { key: "comment", label: "💬 Frage oder Antwort zu einem Wunsch" },
];

export function NotificationSettings() {
  const { me } = useApp();
  const [deviceOn, setDeviceOn] = useState(null); // null = lädt
  const [prefs, setPrefs] = useState({ expert: true, meal: true, suggestion: true, comment: true });
  const [hasComment, setHasComment] = useState(true); // false, solange die Spalte in der Datenbank fehlt
  const device = useAction();
  const prefAction = useAction();
  const test = useAction();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("notification_prefs").select("*").eq("person", me.name).maybeSingle();
      if (data) {
        setPrefs({ expert: data.expert, meal: data.meal, suggestion: data.suggestion, comment: data.comment ?? true });
        setHasComment("comment" in data);
      }
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
    const row = { person: me.name, ...next };
    if (!hasComment) delete row.comment;
    const ok = await prefAction.run(async () => {
      check(await supabase.from("notification_prefs").upsert(row), "Einstellung konnte nicht gespeichert werden");
    });
    if (ok) setPrefs(next);
  };

  let deviceRow;
  if (!pushSupported() && isIOS() && !isStandalone()) {
    deviceRow = html`<div class="list-item"><div class="list-sub">
      <strong>iPhone/iPad:</strong> Benachrichtigungen gehen nur, wenn die App auf dem Home-Bildschirm liegt:
      <strong>Teilen</strong> (□↑) → <strong>„Zum Home-Bildschirm“</strong>, dann die App von dort öffnen.</div></div>`;
  } else if (!pushSupported()) {
    deviceRow = html`<div class="list-item"><div class="list-sub">Dieser Browser unterstützt keine Benachrichtigungen.</div></div>`;
  } else {
    deviceRow = html`
      <label class="list-item switch-row">
        <span><strong>Auf diesem Gerät</strong>
          ${deviceOn && html`<br /><button type="button" class="link-btn" disabled=${test.busy}
            onClick=${(e) => { e.preventDefault(); test.run(() => notify("test"), "Test-Nachricht verschickt"); }}>Test-Nachricht schicken</button>`}
        </span>
        <input type="checkbox" class="switch" checked=${deviceOn === true} disabled=${deviceOn === null || device.busy}
               onChange=${(e) => toggleDevice(e.target.checked)} />
      </label>`;
  }

  return html`
    <h3 class="settings-head">🔔 Benachrichtigungen</h3>
    <div class="card list">
      ${deviceRow}
      ${PREFS.filter((p) => p.key !== "comment" || hasComment).map((p) => html`<label class="list-item switch-row" key=${p.key}>
        <span>${p.label}</span>
        <input type="checkbox" class="switch" checked=${prefs[p.key]} disabled=${prefAction.busy}
               onChange=${(e) => togglePref(p.key, e.target.checked)} />
      </label>`)}
    </div>
    <${Alert} kind="error">${device.error || test.error || prefAction.error}<//>`;
}
