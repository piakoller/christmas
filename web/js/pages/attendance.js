import { html, useState, useApp, useLoader, useAction, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays } from "../lib/season.js";

const STATUS = [
  { key: "absent", label: "Nicht dabei" },
  { key: "present", label: "Dabei" },
  { key: "unsure", label: "Noch unsicher" },
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
    <p class="muted">Hier tragt ihr ein, wer an welchen Tagen dabei ist.</p>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && (me.is_family_account
      ? html`<${Alert} kind="info">${me.name} ist das Familienkonto. Die Anwesenheit trägt jede Person mit ihrem eigenen Login ein.<//>`
      : html`<${MyAttendance} key=${mine?.updated_at || "neu"} entry=${mine} onSaved=${reload} />`)}
    ${data && html`<${Overview} rows=${data} />`}`;
}

function MyAttendance({ entry, onSaved }) {
  const { me, season } = useApp();
  const days = christmasDays(season);
  const [state, setState] = useState(() => Object.fromEntries(days.map((d) => [d.date, {
    status: "absent", with_partner: false, overnight: false, ...(entry?.days?.[d.date] || {}),
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
    }, "Anwesenheit gespeichert").then((ok) => ok && onSaved());
  };

  return html`
    <form class="card form" novalidate onSubmit=${save}>
      <h3>📝 Deine Anwesenheit, ${me.name}</h3>
      ${days.map((d) => {
        const s = state[d.date];
        return html`<div key=${d.date} style="border-top:1px solid var(--border);padding-top:.6rem">
          <div style="font-weight:700">${d.emoji} ${d.name}</div>
          <div class="row" role="radiogroup" aria-label=${d.name} style="margin:.35rem 0">
            ${STATUS.map((st) => html`<label class="check">
              <input type="radio" name=${`status-${d.date}`} checked=${s.status === st.key} onChange=${() => update(d.date, { status: st.key })} />
              ${st.label}</label>`)}
          </div>
          <div class="row">
            <label class="check"><input type="checkbox" checked=${s.with_partner} disabled=${s.status === "absent"}
              onChange=${(e) => update(d.date, { with_partner: e.target.checked })} /> + Partner/in</label>
            <label class="check"><input type="checkbox" checked=${s.overnight} disabled=${s.status === "absent"}
              onChange=${(e) => update(d.date, { overnight: e.target.checked })} /> 🌙 Übernachtung</label>
          </div>
        </div>`;
      })}
      <label class="field"><span>Besondere Hinweise (Allergien, Diät-Wünsche, …)</span>
        <textarea maxlength="1000" value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
      </label>
      <div><button class="btn primary" disabled=${busy}>💾 Speichern</button></div>
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
      ${relevant.length > 0 && html`<div class="grid">
        ${christmasDays(season).map((d) => {
          const present = relevant.filter((r) => r.days?.[d.date]?.status === "present");
          const unsure = relevant.filter((r) => r.days?.[d.date]?.status === "unsure");
          const persons = present.length + present.filter((r) => r.days[d.date].with_partner).length;
          const label = (r) => `${r.person}${r.days[d.date].with_partner ? " (+Partner/in)" : ""}${r.days[d.date].overnight ? " 🌙" : ""}`;
          return html`<div class="card" key=${d.date}>
            <h3>${d.emoji} ${d.name}</h3>
            <div class="metric" style="border:0;padding:0;margin-bottom:.5rem"><span class="value">${persons}</span> <span class="label">Personen sicher dabei</span></div>
            ${present.length > 0 && html`<div>✅ ${present.map(label).join(", ")}</div>`}
            ${unsure.length > 0 && html`<div style="margin-top:.3rem">❓ ${unsure.map(label).join(", ")}</div>`}
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
