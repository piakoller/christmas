import { html, useState, useApp, useLoader, useAction, navigate, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays } from "../lib/season.js";
import { notify } from "../lib/push.js";

const CATEGORIES = [
  { key: "Vorspeise", icon: "🥗" },
  { key: "Hauptspeise", icon: "🍖" },
  { key: "Nachspeise", icon: "🍰" },
  { key: "Snacks", icon: "🥨" },
];

const TABS = [
  { key: "vorschlaege", label: "🍴 Vorschläge" },
  { key: "plan", label: "📅 Menüplan" },
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

export function MealsPage({ params }) {
  const { season } = useApp();
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab : "vorschlaege";
  const { data, error, loading, reload } = useLoader(() => loadMeals(season), [season]);

  return html`
    <${BackLink} />
    <h1>🍽️ Essensplanung</h1>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => html`<button role="tab" aria-selected=${tab === t.key} class=${tab === t.key ? "active" : ""}
        onClick=${() => navigate("essen", { tab: t.key })}>${t.label}</button>`)}
    </div>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && tab === "vorschlaege" && html`<${Proposals} data=${data} reload=${reload} />`}
    ${data && tab === "plan" && html`<${MenuPlan} data=${data} reload=${reload} />`}`;
}

// ---------------------------------------------------------------------------
// Vorschläge
// ---------------------------------------------------------------------------
function Proposals({ data, reload }) {
  const [editing, setEditing] = useState(null); // null = zu, "new" = neues Gericht, Objekt = bearbeiten
  const edit = (dish) => { setEditing(dish); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return html`
    ${editing === null
      ? html`<button class="btn primary block" onClick=${() => setEditing("new")}>➕ Gericht vorschlagen</button>`
      : html`<${DishForm} key=${editing?.id || "new"} dish=${editing === "new" ? null : editing} schedule=${data.schedule}
               onDone=${() => { setEditing(null); reload(); }} onCancel=${() => setEditing(null)} />`}
    ${data.dishes.length === 0 && html`<div class="section"><${Empty}>Noch keine Gerichte vorgeschlagen.<//></div>`}
    ${CATEGORIES.map((cat) => {
      const dishes = data.dishes.filter((d) => d.category === cat.key);
      if (!dishes.length) return null;
      return html`<div class="section" key=${cat.key}>
        <h3>${cat.icon} ${cat.key}</h3>
        <div class="card list">
          ${dishes.map((d) => html`<${DishItem} key=${d.id} dish=${d} votes=${data.votes.filter((v) => v.dish_id === d.id)}
            reload=${reload} onEdit=${() => edit(d)} />`)}
        </div>
      </div>`;
    })}`;
}

function ResponsibleSelect({ value, onChange, disabled, className = "" }) {
  const { people } = useApp();
  return html`<select class=${className} value=${value || ""} disabled=${disabled} aria-label="Wer kümmert sich?"
      onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">👤 Wer kümmert sich?</option>
    ${people.map((p) => html`<option value=${p.name}>👤 ${p.name}</option>`)}
  </select>`;
}

// Neues Gericht vorschlagen oder ein bestehendes bearbeiten (eigene und fremde)
function DishForm({ dish, schedule, onDone, onCancel }) {
  const { me, season } = useApp();
  const editing = Boolean(dish);
  const [name, setName] = useState(dish?.name || "");
  const [category, setCategory] = useState(dish?.category || "Hauptspeise");
  const [description, setDescription] = useState(dish?.description || "");
  const [responsible, setResponsible] = useState(dish?.responsible || null);
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Bitte gib einen Namen für das Gericht ein.");
    const fields = { name: name.trim(), category, description: description.trim(), responsible };
    let saved = null;
    const ok = await run(async () => {
      if (!editing) {
        saved = check(await supabase.from("dishes").insert({ ...fields, season, proposed_by: me.name }).select().single(),
          "Gericht konnte nicht gespeichert werden");
        return;
      }
      saved = check(await supabase.from("dishes").update(fields).eq("id", dish.id).select().single(),
        "Gericht konnte nicht gespeichert werden");
      // Neue Kategorie: im Menüplan mitwandern lassen statt herausfallen
      if (category !== dish.category) {
        const planned = schedule.filter((s) => s.dish_id === dish.id);
        if (planned.length) {
          check(await supabase.from("meal_schedule").delete().eq("dish_id", dish.id), "Menüplan konnte nicht angepasst werden");
          check(await supabase.from("meal_schedule").insert(planned.map((s) => ({ season: s.season, day: s.day, category, dish_id: dish.id }))),
            "Menüplan konnte nicht angepasst werden");
        }
      }
    }, editing ? "Gericht gespeichert" : `„${name.trim()}“ vorgeschlagen`);
    if (ok) {
      const newResponsible = saved.responsible && saved.responsible !== me.name && saved.responsible !== dish?.responsible;
      if (newResponsible) notify("meal", saved.id).catch(console.warn);
      onDone();
    }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <div class="row between"><h3 style="margin:0">${editing ? "Gericht bearbeiten" : "Neues Gericht"}</h3>
        <button type="button" class="btn ghost small" onClick=${onCancel} aria-label="Schließen">✕</button></div>
      ${editing && dish.proposed_by !== me.name && html`<small class="muted">Vorgeschlagen von ${dish.proposed_by}</small>`}
      <input type="text" maxlength="200" placeholder="Gericht, z. B. Raclette" aria-label="Gericht"
             value=${name} onInput=${(e) => setName(e.target.value)} />
      <div class="segmented four" role="radiogroup" aria-label="Kategorie">
        ${CATEGORIES.map((c) => html`<button type="button" role="radio" aria-checked=${category === c.key}
          class=${category === c.key ? "on" : ""} onClick=${() => setCategory(c.key)} title=${c.key}>${c.icon} ${c.key === "Hauptspeise" ? "Haupt" : c.key === "Nachspeise" ? "Dessert" : c.key === "Vorspeise" ? "Vorsp." : c.key}</button>`)}
      </div>
      <${ResponsibleSelect} value=${responsible} onChange=${setResponsible} />
      <textarea maxlength="2000" rows="2" style="min-height:0" placeholder="Notizen (optional)" aria-label="Notizen"
                value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
      <button class="btn primary block" disabled=${busy}>${editing ? "Speichern" : "Vorschlagen"}</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

function DishItem({ dish, votes, reload, onEdit }) {
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

  const remove = () => confirm(`„${dish.name}“ löschen? Es verschwindet auch aus dem Menüplan.`)
    && action.run(async () => check(await supabase.from("dishes").delete().eq("id", dish.id), "Konnte nicht gelöscht werden"), "Gericht gelöscht")
      .then((ok) => ok && reload());

  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${dish.name}</div>
        ${dish.description && html`<div class="list-sub">${dish.description}</div>`}
        <div class="list-meta">
          <${ResponsibleSelect} className="chip-select" value=${dish.responsible} disabled=${action.busy} onChange=${setResponsible} />
          <span class="muted">von ${dish.proposed_by === me.name ? "dir" : dish.proposed_by}</span>
          <button class="link-btn" disabled=${action.busy} onClick=${onEdit}>Bearbeiten</button>
          ${dish.proposed_by === me.name && html`<button class="link-btn danger" disabled=${action.busy} onClick=${remove}>Löschen</button>`}
        </div>
        <${Alert} kind="error">${action.error}<//>
      </div>
      <button class=${`vote ${voted ? "on" : ""}`} disabled=${action.busy} onClick=${toggleVote} aria-pressed=${voted}
              title=${votes.length ? `Dafür: ${votes.map((v) => v.voter).join(", ")}` : "Dafür stimmen"}>
        👍<span>${votes.length}</span>
      </button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Menüplan: ein Tag nach dem anderen
// ---------------------------------------------------------------------------
function MenuPlan({ data, reload }) {
  const { season } = useApp();
  const days = christmasDays(season);
  const [selected, setSelected] = useState(days[1].date); // Heiligabend
  const day = days.find((d) => d.date === selected);

  if (data.dishes.length === 0) {
    return html`<${Empty}>Schlagt zuerst Gerichte vor, dann könnt ihr sie hier auf die Tage verteilen.
      <div style="margin-top:.75rem"><button class="btn" onClick=${() => navigate("essen", { tab: "vorschlaege" })}>Zu den Vorschlägen</button></div><//>`;
  }

  const countFor = (date) => data.schedule.filter((s) => s.day === date).length;
  return html`
    <div class="segmented four" role="tablist" aria-label="Tag">
      ${days.map((d) => html`<button type="button" role="tab" aria-selected=${selected === d.date}
        class=${selected === d.date ? "on" : ""} onClick=${() => setSelected(d.date)}>
        ${d.short}${countFor(d.date) ? html` <span class="count-dot">${countFor(d.date)}</span>` : ""}
      </button>`)}
    </div>
    <div class="card" style="margin-top:.75rem">
      <h3>${day.emoji} ${day.title}</h3>
      ${CATEGORIES.map((cat) => html`<${PlanSlot} key=${cat.key + selected} day=${selected} category=${cat} data=${data} reload=${reload} />`)}
    </div>`;
}

function PlanSlot({ day, category, data, reload }) {
  const { season } = useApp();
  const action = useAction();
  const assigned = data.schedule.filter((s) => s.day === day && s.category === category.key)
    .map((s) => data.dishes.find((d) => d.id === s.dish_id)).filter(Boolean);
  const options = data.dishes.filter((d) => d.category === category.key && !assigned.some((a) => a.id === d.id));
  if (!assigned.length && !options.length) return null; // keine Gerichte dieser Art – Zeile ausblenden

  const add = (dishId) => dishId && action.run(async () => {
    check(await supabase.from("meal_schedule").insert({ season, day, category: category.key, dish_id: dishId }), "Konnte nicht eingeplant werden");
  }).then((ok) => ok && reload());

  const remove = (dishId) => action.run(async () => {
    check(await supabase.from("meal_schedule").delete().eq("day", day).eq("category", category.key).eq("dish_id", dishId), "Konnte nicht entfernt werden");
  }).then((ok) => ok && reload());

  return html`
    <div class="plan-slot">
      <div class="plan-cat">${category.icon} ${category.key}</div>
      <div class="chips">
        ${assigned.map((d) => html`<span class="chip on" key=${d.id}>
          ${d.name}${d.responsible ? html` <small>· ${d.responsible}</small>` : ""}
          <button class="chip-x" aria-label=${`${d.name} entfernen`} disabled=${action.busy} onClick=${() => remove(d.id)}>✕</button>
        </span>`)}
        ${options.length > 0 && html`<select class="chip-select" value="" disabled=${action.busy}
            aria-label=${`${category.key} hinzufügen`} onChange=${(e) => add(e.target.value)}>
          <option value="">＋ hinzufügen</option>
          ${options.map((d) => html`<option value=${d.id}>${d.name}</option>`)}
        </select>`}
      </div>
      <${Alert} kind="error">${action.error}<//>
    </div>`;
}
