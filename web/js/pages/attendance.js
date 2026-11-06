import { html, useState, useApp, useLoader, useAction, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays } from "../lib/season.js";

// Mögliche Antworten pro Tag (Reihenfolge = Anzeige im Umschalter)
const STATUS = [
  { key: "present", label: "✓ Dabei" },
  { key: "unsure", label: "? Unsicher" },
  { key: "absent", label: "✕ Nein" },
];

async function loadAttendance(season) {
  return check(await supabase.from("attendance").select("*").eq("season", season), "Anwesenheit konnte nicht geladen werden");
}

export function AttendancePage() {
  const { me, season } = useApp();
  const { data, error, loading, reload } = useLoader(() => loadAttendance(season), [season]);
  const mine = data?.find((r) => r.person === me.name);

  return html`
    <${BackLink} />
    <h1>📅 Wer kommt wann?</h1>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && (me.is_family_account
      ? html`<${Alert} kind="info">${me.name} ist das Familienkonto. Die Anwesenheit trägt jede Person mit ihrem eigenen Login ein.<//>`
      : html`<${MyAttendance} key=${mine?.updated_at || "neu"} entry=${mine} onSaved=${reload} />`)}
    ${data && html`<${Overview} rows=${data} />`}`;
}

function DayTitle({ day }) {
  return html`<div class="day-title">
    <span aria-hidden="true">${day.emoji}</span> <strong>${day.title}</strong> <span class="muted">· ${day.short}</span>
  </div>`;
}

function MyAttendance({ entry, onSaved }) {
  const { me, season } = useApp();
  const days = christmasDays(season);
  const [state, setState] = useState(() => Object.fromEntries(days.map((d) => [d.date, {
    status: null, with_partner: false, overnight: false, ...(entry?.days?.[d.date] || {}),
  }])));
  const [notes, setNotes] = useState(entry?.notes || "");
  const { busy, error, run } = useAction();

  const update = (date, patch) => setState((s) => {
    const next = { ...s[date], ...patch };
    if (next.status === "absent") { next.with_partner = false; next.overnight = false; }
    return { ...s, [date]: next };
  });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      check(await supabase.from("attendance").upsert({
        season, person: me.name, days: state, notes: notes.trim(), updated_at: new Date().toISOString(),
      }), "Anwesenheit konnte nicht gespeichert werden");
    }, "Gespeichert").then((ok) => ok && onSaved());
  };

  return html`
    <form class="card form" novalidate onSubmit=${save}>
      <h3>Bist du dabei, ${me.name}?</h3>
      ${days.map((d) => {
        const s = state[d.date];
        const coming = s.status === "present" || s.status === "unsure";
        return html`<div class="day-row" key=${d.date}>
          <${DayTitle} day=${d} />
          <div class="segmented" role="radiogroup" aria-label=${d.name}>
            ${STATUS.map((st) => html`<button type="button" role="radio" aria-checked=${s.status === st.key}
              class=${`seg-${st.key} ${s.status === st.key ? "on" : ""}`}
              onClick=${() => update(d.date, { status: st.key })}>${st.label}</button>`)}
          </div>
          ${coming && html`<div class="chips">
            <button type="button" class=${`chip ${s.with_partner ? "on" : ""}`} aria-pressed=${s.with_partner}
              onClick=${() => update(d.date, { with_partner: !s.with_partner })}>+ Partner/in</button>
            <button type="button" class=${`chip ${s.overnight ? "on" : ""}`} aria-pressed=${s.overnight}
              onClick=${() => update(d.date, { overnight: !s.overnight })}>🌙 Übernachtung</button>
          </div>`}
        </div>`;
      })}
      <label class="field"><span>Hinweise (Allergien, Diät …)</span>
        <textarea maxlength="1000" rows="2" style="min-height:0" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
      </label>
      <button class="btn primary block" disabled=${busy}>💾 Speichern</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

function Overview({ rows }) {
  const { season, people } = useApp();
  const relevant = rows.filter((r) => people.some((p) => p.name === r.person));
  const missing = people.filter((p) => !rows.some((r) => r.person === p.name)).map((p) => p.name);
  const notes = relevant.filter((r) => r.notes);

  return html`
    <div class="section">
      <h2>👥 Übersicht</h2>
      ${relevant.length === 0 && html`<${Empty}>Noch niemand hat sich eingetragen.<//>`}
      ${relevant.length > 0 && html`<div class="card">
        ${christmasDays(season).map((d) => {
          const present = relevant.filter((r) => r.days?.[d.date]?.status === "present");
          const unsure = relevant.filter((r) => r.days?.[d.date]?.status === "unsure");
          const persons = present.length + present.filter((r) => r.days[d.date].with_partner).length;
          const label = (r) => `${r.person}${r.days[d.date].with_partner ? " +1" : ""}${r.days[d.date].overnight ? " 🌙" : ""}`;
          return html`<div class="day-row" key=${d.date}>
            <div class="row between"><${DayTitle} day=${d} /><span class="badge green">${persons} 👤</span></div>
            ${present.length > 0 && html`<div>✓ ${present.map(label).join(", ")}</div>`}
            ${unsure.length > 0 && html`<div class="muted">? ${unsure.map(label).join(", ")}</div>`}
            ${present.length + unsure.length === 0 && html`<small class="muted">Noch niemand</small>`}
          </div>`;
        })}
      </div>`}
      ${missing.length > 0 && html`<p class="muted" style="margin-top:.75rem">Noch nicht eingetragen: ${missing.join(", ")}</p>`}
      ${notes.length > 0 && html`<div class="card" style="margin-top:1rem">
        <h3>📝 Hinweise</h3>
        ${notes.map((r) => html`<p key=${r.person}><strong>${r.person}:</strong> ${r.notes}</p>`)}
      </div>`}
    </div>`;
}
