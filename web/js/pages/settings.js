import { html, useState, useApp, useAction, Alert, BackLink } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { changePin, resetPin, isValidPin, logout } from "../auth.js";
import { NotificationSettings } from "../lib/push.js";

export function SettingsPage() {
  const { me } = useApp();
  return html`
    <${BackLink} />
    <h1>⚙️ Einstellungen</h1>
    <div class="stack">
      <${NotificationSettings} />
      <${ChangePin} />
      ${me.is_admin && html`<${AdminArea} />`}
      <div class="card">
        <h3>Abmelden</h3>
        <p class="muted">Meldet dich auf diesem Gerät ab.</p>
        <button class="btn" onClick=${() => logout()}>🚪 Abmelden</button>
      </div>
    </div>`;
}

function ChangePin() {
  const { me } = useApp();
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    if (!isValidPin(newPin)) return setError("Die PIN muss aus 4 bis 8 Ziffern bestehen.");
    if (newPin.trim() !== repeat.trim()) return setError("Die beiden PINs stimmen nicht überein.");
    const ok = await run(() => changePin(me.name, oldPin, newPin), "PIN geändert. Andere Geräte sind jetzt abgemeldet.");
    if (ok) { setOldPin(""); setNewPin(""); setRepeat(""); }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <h3>🔑 PIN ändern</h3>
      <label class="field"><span>Aktuelle PIN</span>
        <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password"
               value=${oldPin} onInput=${(e) => setOldPin(e.target.value)} />
      </label>
      <div class="form-row">
        <label class="field"><span>Neue PIN</span>
          <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
                 placeholder="4 bis 8 Ziffern" value=${newPin} onInput=${(e) => setNewPin(e.target.value)} />
        </label>
        <label class="field"><span>Neue PIN wiederholen</span>
          <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
                 value=${repeat} onInput=${(e) => setRepeat(e.target.value)} />
        </label>
      </div>
      <div><button class="btn green" disabled=${busy || !oldPin}>PIN ändern</button></div>
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
    <div class="card form">
      <h3>👑 Verwaltung</h3>
      <div>
        <label class="field"><span>PIN zurücksetzen für</span>
          <select value=${target} onChange=${(e) => setTarget(e.target.value)}>
            ${others.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
          </select>
        </label>
        <div style="margin-top:.6rem"><button class="btn" disabled=${reset.busy} onClick=${doReset}>PIN zurücksetzen</button></div>
        <${Alert} kind="error">${reset.error}<//>
      </div>
      <label class="check">
        <input type="checkbox" checked=${settings.advent_calendar === true} disabled=${toggle.busy}
               onChange=${(e) => setFlag("advent_calendar", e.target.checked)} />
        Adventskalender für alle anzeigen
      </label>
      <${Alert} kind="error">${toggle.error}<//>
    </div>`;
}
