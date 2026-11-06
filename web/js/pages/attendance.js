import { html, useState, useApp, useLoader, useAction, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays, shortDate } from "../lib/season.js";

// Mögliche Antworten pro Tag/Treffen (Reihenfolge = Anzeige im Umschalter)
const STATUS = [
  { key: "present", label: "✓ Dabei" },
  { key: "unsure", label: "? Unsicher" },
  { key: "absent", label: "✕ Nein" },
];
const EMOJIS = ["🔥", "🍷", "🍪", "🎄", "⛸️", "🎶", "🍽️", "📅"];

async function loadAttendance(season) {
  const [rows, events] = await Promise.all([
    supabase.from("attendance").select("*").eq("season", season),
    supabase.from("events").select("*").eq("season", season).order("created_at"),
  ]);
  if (events.error) console.warn("Treffen konnten nicht geladen werden", events.error);
  return {
    rows: check(rows, "Anwesenheit konnte nicht geladen werden"),
    events: events.error ? [] : events.data, // ohne Tabelle "events" einfach nur die Weihnachtstage
  };
}

// Weihnachtstage + eigene Treffen, nach Datum sortiert; Treffen ohne Datum am Ende
function allDays(season, events) {
  const fixed = christmasDays(season).map((d) => ({ ...d, sort: d.date }));
  const extra = events.map((e) => ({
    date: `event:${e.id}`, title: e.title, emoji: e.emoji, name: e.title,
    short: e.event_date ? shortDate(e.event_date) : "Datum folgt",
    sort: e.event_date || "9999", event: e,
  }));
  return [...fixed, ...extra].sort((a, b) => a.sort.localeCompare(b.sort));
}

export function AttendancePage() {
  const { me, season } = useApp();
  const { data, error, loading, reload } = useLoader(() => loadAttendance(season), [season]);
  const [eventForm, setEventForm] = useState(null); // null = zu, "new" oder ein Treffen
  const mine = data?.rows.find((r) => r.person === me.name);
  const days = data ? allDays(season, data.events) : [];

  const openForm = (value) => { setEventForm(value); setTimeout(() => document.getElementById("event-form")?.scrollIntoView({ behavior: "smooth" }), 50); };

  return html`
    <${BackLink} />
    <h1>📅 Wer kommt wann?</h1>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && (me.is_family_account
      ? html`<${Alert} kind="info">${me.name} ist das Familienkonto. Die Anwesenheit trägt jede Person mit ihrem eigenen Login ein.<//>`
      : html`<${MyAttendance} key=${`${mine?.updated_at || "neu"}-${data.events.length}`} entry=${mine} days=${days}
               onSaved=${reload} onEditEvent=${openForm} />`)}
    ${data && html`<div style="margin-top:.75rem" id="event-form">
      ${eventForm === null
        ? html`<button class="btn block" onClick=${() => openForm("new")}>➕ Weiteres Treffen anlegen</button>`
        : html`<${EventForm} key=${eventForm?.id || "new"} event=${eventForm === "new" ? null : eventForm}
                 onDone=${() => { setEventForm(null); reload(); }} onCancel=${() => setEventForm(null)} />`}
    </div>`}
    ${data && html`<${Overview} rows=${data.rows} days=${days} />`}`;
}

function DayTitle({ day, onEdit }) {
  return html`<div class="day-title">
    <span aria-hidden="true">${day.emoji}</span> <strong>${day.title}</strong> <span class="muted">· ${day.short}</span>
    ${onEdit && html` <button type="button" class="link-btn" onClick=${onEdit}>Bearbeiten</button>`}
  </div>`;
}

function canEdit(me, event) {
  return event && (event.created_by === me.name || me.is_admin);
}

function MyAttendance({ entry, days, onSaved, onEditEvent }) {
  const { me, season } = useApp();
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
    // Antworten zu gelöschten Treffen nicht mitspeichern
    const known = Object.fromEntries(Object.entries(state).filter(([key]) => days.some((d) => d.date === key)));
    run(async () => {
      check(await supabase.from("attendance").upsert({
        season, person: me.name, days: known, notes: notes.trim(), updated_at: new Date().toISOString(),
      }), "Anwesenheit konnte nicht gespeichert werden");
    }, "Gespeichert").then((ok) => ok && onSaved());
  };

  return html`
    <form class="card form" novalidate onSubmit=${save}>
      <h3>Bist du dabei, ${me.name}?</h3>
      ${days.map((d) => {
        const s = state[d.date] || { status: null };
        const coming = s.status === "present" || s.status === "unsure";
        return html`<div class="day-row" key=${d.date}>
          <${DayTitle} day=${d} onEdit=${canEdit(me, d.event) ? () => onEditEvent(d.event) : null} />
          <div class="segmented" role="radiogroup" aria-label=${d.name}>
            ${STATUS.map((st) => html`<button type="button" role="radio" aria-checked=${s.status === st.key}
              class=${`seg-${st.key} ${s.status === st.key ? "on" : ""}`}
              onClick=${() => update(d.date, { status: st.key })}>${st.label}</button>`)}
          </div>
          ${coming && html`<div class="chips">
            <button type="button" class=${`chip ${s.with_partner ? "on" : ""}`} aria-pressed=${s.with_partner}
              onClick=${() => update(d.date, { with_partner: !s.with_partner })}>+ Partner/in</button>
            ${!d.event && html`<button type="button" class=${`chip ${s.overnight ? "on" : ""}`} aria-pressed=${s.overnight}
              onClick=${() => update(d.date, { overnight: !s.overnight })}>🌙 Übernachtung</button>`}
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

function EventForm({ event, onDone, onCancel }) {
  const { me, season } = useApp();
  const editing = Boolean(event);
  const [emoji, setEmoji] = useState(event?.emoji || "🔥");
  const [title, setTitle] = useState(event?.title || "");
  const [date, setDate] = useState(event?.event_date || "");
  const { busy, error, setError, run } = useAction();

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError("Bitte gib dem Treffen einen Namen.");
    const fields = { title: title.trim(), emoji, event_date: date || null };
    const ok = await run(async () => {
      check(editing
        ? await supabase.from("events").update(fields).eq("id", event.id)
        : await supabase.from("events").insert({ ...fields, season, created_by: me.name }), "Treffen konnte nicht gespeichert werden");
    }, editing ? "Treffen gespeichert" : `„${title.trim()}“ angelegt`);
    if (ok) onDone();
  };

  const remove = async () => {
    if (!confirm(`„${event.title}“ wirklich löschen?`)) return;
    const ok = await run(async () => {
      check(await supabase.from("events").delete().eq("id", event.id), "Treffen konnte nicht gelöscht werden");
    }, "Treffen gelöscht");
    if (ok) onDone();
  };

  return html`
    <form class="card form" novalidate onSubmit=${save}>
      <div class="row between"><h3 style="margin:0">${editing ? "Treffen bearbeiten" : "Neues Treffen"}</h3>
        <button type="button" class="btn ghost small" aria-label="Schließen" onClick=${onCancel}>✕</button></div>
      <div class="chips" role="radiogroup" aria-label="Symbol">
        ${EMOJIS.map((em) => html`<button type="button" role="radio" aria-checked=${emoji === em}
          class=${`chip emoji-chip ${emoji === em ? "on" : ""}`} onClick=${() => setEmoji(em)}>${em}</button>`)}
      </div>
      <input type="text" maxlength="100" placeholder="z. B. Glühwein & Plätzchen an der Feuerschale" aria-label="Name des Treffens"
             value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <label class="field"><span>Datum (optional – sonst „Datum folgt“)</span>
        <input type="date" value=${date} min=${`${season}-11-01`} max=${`${season + 1}-01-31`} onInput=${(e) => setDate(e.target.value)} />
      </label>
      <button class="btn primary block" disabled=${busy}>${editing ? "Speichern" : "Treffen anlegen"}</button>
      ${editing && html`<button type="button" class="link-btn danger" style="align-self:center" disabled=${busy} onClick=${remove}>Treffen löschen</button>`}
      <${Alert} kind="error">${error}<//>
    </form>`;
}

function Overview({ rows, days }) {
  const { people } = useApp();
  const relevant = rows.filter((r) => people.some((p) => p.name === r.person));
  const missing = people.filter((p) => !rows.some((r) => r.person === p.name)).map((p) => p.name);
  const notes = relevant.filter((r) => r.notes);

  return html`
    <div class="section">
      <h2>👥 Übersicht</h2>
      ${relevant.length === 0 && html`<${Empty}>Noch niemand hat sich eingetragen.<//>`}
      ${relevant.length > 0 && html`<div class="card">
        ${days.map((d) => {
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
