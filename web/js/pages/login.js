import { html, useState, useEffect, Alert, Avatar, Loading } from "../ui.js";
import { loadLoginProfiles, login, setupPin, isValidPin } from "../auth.js";
import { currentSeasonYear, daysUntilChristmasEve } from "../lib/season.js";

export function LoginPage() {
  const [profiles, setProfiles] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const season = currentSeasonYear();
  const days = daysUntilChristmasEve();

  useEffect(() => {
    loadLoginProfiles().then(setProfiles).catch((e) => setLoadError(e.message));
  }, []);

  const person = profiles?.find((p) => p.name === selected);

  return html`
    <div class="login">
      <div class="hero centered">
        <div style="font-size:2.6rem;line-height:1" aria-hidden="true">🎄</div>
        <h1>Weihnachten ${season}</h1>
        <p style="color:var(--gold);font-weight:700;opacity:1">
          Noch ${days} ${days === 1 ? "Tag" : "Tage"} bis Heiligabend
        </p>
      </div>
      <div class="pick-title">Wer bist du?</div>
      ${loadError && html`<${Alert} kind="error">${loadError}<//>`}
      ${!profiles && !loadError && html`<${Loading} />`}
      ${profiles && html`
        <div class="avatars">
          ${profiles.map((p) => html`
            <button type="button" class=${`avatar-btn ${selected === p.name ? "selected" : ""}`}
                    aria-pressed=${selected === p.name} onClick=${() => setSelected(p.name)}>
              <${Avatar} profile=${p} />
              <span class="label">${p.name}</span>
            </button>`)}
        </div>`}
      ${!person && profiles && html`<p class="center muted">Tippe auf deinen Namen, um dich anzumelden.</p>`}
      ${person && (person.has_pin
        ? html`<${PinForm} key=${person.name} name=${person.name} />`
        : html`<${SetupForm} key=${person.name} name=${person.name} />`)}
    </div>`;
}

function RememberBox({ value, onChange }) {
  return html`<label class="check" title="Auf fremden Geräten ausschalten">
    <input type="checkbox" checked=${value} onChange=${(e) => onChange(e.target.checked)} />
    Angemeldet bleiben
  </label>`;
}

function PinForm({ name }) {
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(name, pin, remember);
    } catch (err) {
      setError(err.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <label class="field"><span>PIN für ${name}</span>
        <input type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]*"
               placeholder="••••" value=${pin} onInput=${(e) => setPin(e.target.value)} autofocus />
      </label>
      <${RememberBox} value=${remember} onChange=${setRemember} />
      <button class="btn primary block" disabled=${busy || !pin}>${busy ? "Anmelden …" : "Anmelden"}</button>
      <${Alert} kind="error">${error}<//>
      <small>PIN vergessen? Pia kann sie zurücksetzen.</small>
    </form>`;
}

function SetupForm({ name }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!code.trim()) return setError("Bitte gib den Familien-Code ein.");
    if (!isValidPin(pin)) return setError("Die PIN muss aus 4 bis 8 Ziffern bestehen.");
    if (pin.trim() !== repeat.trim()) return setError("Die beiden PINs stimmen nicht überein.");
    setBusy(true);
    try {
      await setupPin(name, code, pin, remember);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <${Alert} kind="info">Hallo ${name}! Du hast noch keine PIN. Gib den Familien-Code ein und wähle deine PIN.<//>
      <label class="field"><span>Familien-Code</span>
        <input type="password" autocomplete="off" value=${code} onInput=${(e) => setCode(e.target.value)} />
      </label>
      <div class="form-row">
        <label class="field"><span>Deine neue PIN</span>
          <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
                 placeholder="4 bis 8 Ziffern" value=${pin} onInput=${(e) => setPin(e.target.value)} />
        </label>
        <label class="field"><span>PIN wiederholen</span>
          <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
                 value=${repeat} onInput=${(e) => setRepeat(e.target.value)} />
        </label>
      </div>
      <${RememberBox} value=${remember} onChange=${setRemember} />
      <button class="btn primary block" disabled=${busy}>${busy ? "Speichern …" : "PIN speichern und anmelden"}</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}
