import { html, useState, useApp, useLoader, useAction, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays } from "../lib/season.js";
import { notify } from "../lib/push.js";

const CATEGORIES = [
  { key: "Vorspeise", icon: "🥗" },
  { key: "Hauptspeise", icon: "🍖" },
  { key: "Nachspeise", icon: "🍰" },
  { key: "Snacks", icon: "🥨" },
];

async function loadMeals(season) {
  const [dishes, votes, schedule] = await Promise.all([
    supabase.from("dishes").select("*").eq("season", season).order("created_at"),
    supabase.from("dish_votes").select("*"),
    supabase.from("meal_schedule").select("*").eq("season", season),
  ]);
  const dishList = check(dishes, "Gerichte konnten nicht geladen werden");
  const ids = new Set(dishList.map((d) => d.id));
  return {
    dishes: dishList,
    votes: check(votes, "Stimmen konnten nicht geladen werden").filter((v) => ids.has(v.dish_id)),
    schedule: check(schedule, "Plan konnte nicht geladen werden"),
  };
}

export function MealsPage() {
  const { season } = useApp();
  const { data, error, loading, reload } = useLoader(() => loadMeals(season), [season]);
  return html`
    <${BackLink} />
    <h1>🍽️ Essensplanung</h1>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && html`
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
        <div>
          <h2>🍴 Gerichtsvorschläge</h2>
          <${DishForm} onDone=${reload} />
          <${DishList} data=${data} reload=${reload} />
        </div>
        <div>
          <h2>📅 Wann gibt es was?</h2>
          <${Schedule} data=${data} reload=${reload} />
        </div>
      </div>`}`;
}

function ResponsibleSelect({ value, onChange, disabled }) {
  const { people } = useApp();
  return html`<select value=${value || ""} disabled=${disabled} onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">– noch offen –</option>
    ${people.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
  </select>`;
}

function DishForm({ onDone }) {
  const { me, season } = useApp();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Hauptspeise");
  const [description, setDescription] = useState("");
  const [responsible, setResponsible] = useState(null);
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Bitte gib einen Namen für das Gericht ein.");
    let saved = null;
    const ok = await run(async () => {
      saved = check(await supabase.from("dishes").insert({
        season, name: name.trim(), category, description: description.trim(), proposed_by: me.name, responsible,
      }).select().single(), "Gericht konnte nicht gespeichert werden");
    }, `„${name.trim()}“ vorgeschlagen`);
    if (ok) {
      if (saved.responsible && saved.responsible !== me.name) notify("meal", saved.id).catch(console.warn);
      setName(""); setDescription(""); setResponsible(null);
      onDone();
    }
  };

  return html`
    <details class="box" style="margin-bottom:1rem">
      <summary>➕ Neues Gericht vorschlagen</summary>
      <form class="form" novalidate onSubmit=${submit}>
        <label class="field"><span>Gericht</span>
          <input type="text" maxlength="200" placeholder="z. B. Raclette" value=${name} onInput=${(e) => setName(e.target.value)} />
        </label>
        <div class="form-row">
          <label class="field"><span>Kategorie</span>
            <select value=${category} onChange=${(e) => setCategory(e.target.value)}>
              ${CATEGORIES.map((c) => html`<option value=${c.key}>${c.icon} ${c.key}</option>`)}
            </select>
          </label>
          <label class="field"><span>Wer kümmert sich?</span>
            <${ResponsibleSelect} value=${responsible} onChange=${setResponsible} />
          </label>
        </div>
        <label class="field"><span>Beschreibung / Notizen</span>
          <textarea maxlength="2000" placeholder="Zutaten, Zubereitung …" value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
        </label>
        <div><button class="btn primary" disabled=${busy}>Vorschlagen</button></div>
        <${Alert} kind="error">${error}<//>
      </form>
    </details>`;
}

function DishList({ data, reload }) {
  if (data.dishes.length === 0) return html`<${Empty}>Noch keine Gerichtsvorschläge.<//>`;
  return CATEGORIES.map((cat) => {
    const dishes = data.dishes.filter((d) => d.category === cat.key);
    if (!dishes.length) return null;
    return html`<div key=${cat.key} style="margin-top:1rem">
      <h3>${cat.icon} ${cat.key}</h3>
      ${dishes.map((d) => html`<${DishCard} key=${d.id} dish=${d} votes=${data.votes.filter((v) => v.dish_id === d.id)} reload=${reload} />`)}
    </div>`;
  });
}

function DishCard({ dish, votes, reload }) {
  const { me } = useApp();
  const action = useAction();
  const voted = votes.some((v) => v.voter === me.name);

  const toggleVote = () => action.run(async () => {
    check(voted
      ? await supabase.from("dish_votes").delete().eq("dish_id", dish.id).eq("voter", me.name)
      : await supabase.from("dish_votes").insert({ dish_id: dish.id, voter: me.name }), "Stimme konnte nicht gespeichert werden");
  }).then((ok) => ok && reload());

  const setResponsible = (name) => action.run(async () => {
    check(await supabase.from("dishes").update({ responsible: name }).eq("id", dish.id), "Konnte nicht gespeichert werden");
    if (name && name !== me.name) notify("meal", dish.id).catch(console.warn);
  }, name ? `${name} kümmert sich darum` : "Zuständigkeit entfernt").then((ok) => ok && reload());

  const remove = () => confirm(`„${dish.name}“ löschen? Es verschwindet auch aus dem Tagesplan.`)
    && action.run(async () => check(await supabase.from("dishes").delete().eq("id", dish.id), "Konnte nicht gelöscht werden"), "Gericht gelöscht")
      .then((ok) => ok && reload());

  return html`
    <div class="card">
      <div class="row between"><strong>${dish.name}</strong>
        <button class=${`btn small ${voted ? "green" : ""}`} disabled=${action.busy} onClick=${toggleVote}
                aria-pressed=${voted} title=${voted ? "Stimme zurücknehmen" : "Dafür stimmen"}>👍 ${votes.length}</button>
      </div>
      ${dish.description && html`<p class="muted" style="white-space:pre-line;margin:.35rem 0">${dish.description}</p>`}
      <small>Vorgeschlagen von ${dish.proposed_by}${votes.length ? ` · Dafür: ${votes.map((v) => v.voter).join(", ")}` : ""}</small>
      <div class="row" style="margin-top:.5rem">
        <label class="field" style="flex:1;min-width:180px"><span>Wer kümmert sich?</span>
          <${ResponsibleSelect} value=${dish.responsible} disabled=${action.busy} onChange=${setResponsible} />
        </label>
        ${dish.proposed_by === me.name && html`<button class="btn small danger" style="align-self:flex-end" disabled=${action.busy} onClick=${remove}>🗑️</button>`}
      </div>
      <${Alert} kind="error">${action.error}<//>
    </div>`;
}

function Schedule({ data, reload }) {
  const { season } = useApp();
  return christmasDays(season).map((day) => html`
    <div class="card" key=${day.date}>
      <h3>${day.emoji} ${day.name}</h3>
      ${CATEGORIES.map((cat) => html`<${ScheduleSlot} key=${cat.key} day=${day.date} category=${cat} data=${data} reload=${reload} />`)}
    </div>`);
}

function ScheduleSlot({ day, category, data, reload }) {
  const { season } = useApp();
  const [choice, setChoice] = useState("");
  const action = useAction();
  const assigned = data.schedule.filter((s) => s.day === day && s.category === category.key)
    .map((s) => data.dishes.find((d) => d.id === s.dish_id)).filter(Boolean);
  const options = data.dishes.filter((d) => d.category === category.key && !assigned.some((a) => a.id === d.id));

  const add = () => choice && action.run(async () => {
    check(await supabase.from("meal_schedule").insert({ season, day, category: category.key, dish_id: choice }), "Konnte nicht eingeplant werden");
  }).then((ok) => { if (ok) { setChoice(""); reload(); } });

  const remove = (dishId) => action.run(async () => {
    check(await supabase.from("meal_schedule").delete().eq("day", day).eq("category", category.key).eq("dish_id", dishId), "Konnte nicht entfernt werden");
  }).then((ok) => ok && reload());

  return html`
    <div style="margin:.6rem 0">
      <div style="font-weight:600;font-size:.92rem">${category.icon} ${category.key}</div>
      ${assigned.map((d) => html`<div class="row between" key=${d.id} style="padding:.15rem 0">
        <span>• ${d.name}${d.responsible ? html` <small class="muted">(${d.responsible})</small>` : ""}</span>
        <button class="btn ghost small" aria-label=${`${d.name} entfernen`} disabled=${action.busy} onClick=${() => remove(d.id)}>✕</button>
      </div>`)}
      ${options.length > 0
        ? html`<div class="row" style="margin-top:.25rem">
            <select style="flex:1" value=${choice} onChange=${(e) => setChoice(e.target.value)} aria-label=${`${category.key} hinzufügen`}>
              <option value="">${category.key} hinzufügen …</option>
              ${options.map((d) => html`<option value=${d.id}>${d.name}</option>`)}
            </select>
            <button class="btn small" disabled=${!choice || action.busy} onClick=${add}>Hinzufügen</button>
          </div>`
        : assigned.length === 0 && html`<small class="muted">Keine ${category.key}-Vorschläge vorhanden</small>`}
      <${Alert} kind="error">${action.error}<//>
    </div>`;
}
