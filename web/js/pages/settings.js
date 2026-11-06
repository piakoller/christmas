import { html, useState, useApp, useAction, Alert, BackLink } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { changePin, resetPin, isValidPin, logout } from "../auth.js";
import { NotificationSettings } from "../lib/push.js";

export function SettingsPage() {
  const { me } = useApp();
  return html`
    <${BackLink} />
    <h1>⚙️ Einstellungen</h1>
    <${NotificationSettings} />
    <h3 class="settings-head">🔑 Konto</h3>
    <div class="card list">
      <${ChangePin} />
      <div class="list-item switch-row">
        <span>Angemeldet als <strong>${me.name}</strong></span>
        <button class="btn small" onClick=${() => logout()}>🚪 Abmelden</button>
      </div>
    </div>
    ${me.is_admin && html`<${AdminArea} />`}`;
}

function ChangePin() {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    if (!isValidPin(newPin)) return setError("Die PIN muss aus 4 bis 8 Ziffern bestehen.");
    if (newPin.trim() !== repeat.trim()) return setError("Die beiden PINs stimmen nicht überein.");
    const ok = await run(() => changePin(me.name, oldPin, newPin), "PIN geändert. Andere Geräte sind jetzt abgemeldet.");
    if (ok) { setOldPin(""); setNewPin(""); setRepeat(""); setOpen(false); }
  };

  if (!open) {
    return html`<div class="list-item switch-row">
      <span>PIN ändern</span>
      <button class="btn small" onClick=${() => setOpen(true)}>Ändern</button>
    </div>`;
  }
  const pinInput = (value, set, placeholder, autocomplete) => html`<input type="password" inputmode="numeric" pattern="[0-9]*"
    autocomplete=${autocomplete} placeholder=${placeholder} aria-label=${placeholder} value=${value} onInput=${(e) => set(e.target.value)} />`;
  return html`
    <form class="list-item form" novalidate onSubmit=${submit} style="flex-direction:column;align-items:stretch">
      <div class="row between"><strong>PIN ändern</strong>
        <button type="button" class="btn ghost small" aria-label="Schließen" onClick=${() => setOpen(false)}>✕</button></div>
      ${pinInput(oldPin, setOldPin, "Aktuelle PIN", "current-password")}
      <div class="form-row tight">
        ${pinInput(newPin, setNewPin, "Neue PIN (4–8 Ziffern)", "new-password")}
        ${pinInput(repeat, setRepeat, "Neue PIN wiederholen", "new-password")}
      </div>
      <button class="btn green block" disabled=${busy || !oldPin}>PIN ändern</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

function AdminArea() {
  const { me, profiles, settings, reloadSettings } = useApp();
  const others = profiles.filter((p) => p.name !== me.name);
  const [target, setTarget] = useState(others[0]?.name || "");
  const reset = useAction();
  const toggle = useAction();

  const doReset = () => {
    if (!confirm(`PIN von ${target} wirklich zurücksetzen?`)) return;
    reset.run(() => resetPin(target), `Erledigt. ${target} legt beim nächsten Login mit dem Familien-Code eine neue PIN an.`);
  };

  const setFlag = (key, value) => toggle.run(async () => {
    check(await supabase.from("app_settings").update({ value }).eq("key", key), "Einstellung konnte nicht gespeichert werden");
    await reloadSettings();
  }, value ? "Eingeschaltet" : "Ausgeschaltet");

  return html`
    <h3 class="settings-head">👑 Verwaltung</h3>
    <div class="card list">
      <label class="list-item switch-row">
        <span>Adventskalender für alle anzeigen</span>
        <input type="checkbox" class="switch" checked=${settings.advent_calendar === true} disabled=${toggle.busy}
               onChange=${(e) => setFlag("advent_calendar", e.target.checked)} />
      </label>
      <div class="list-item switch-row">
        <span style="white-space:nowrap">PIN zurücksetzen</span>
        <span class="row" style="gap:.4rem;flex-wrap:nowrap">
          <select class="chip-select" value=${target} onChange=${(e) => setTarget(e.target.value)} aria-label="Für wen?">
            ${others.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
          </select>
          <button class="btn small" disabled=${reset.busy} onClick=${doReset}>Zurücksetzen</button>
        </span>
      </div>
    </div>
    <${Alert} kind="error">${reset.error || toggle.error}<//>`;
}
