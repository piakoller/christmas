import { html, useState, useApp, useLoader, useAction, navigate, Alert, BackLink, Loading, Empty } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { christmasDays } from "../lib/season.js";
import { dateTime } from "../lib/format.js";
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
  { key: "einkauf", label: "🛒 Einkauf" },
];

async function loadMeals(season) {
  const [dishes, votes, schedule, shopping, comments] = await Promise.all([
    supabase.from("dishes").select("*").eq("season", season).order("created_at"),
    supabase.from("dish_votes").select("*"),
    supabase.from("meal_schedule").select("*").eq("season", season),
    supabase.from("shopping_items").select("*").eq("season", season).order("created_at"),
    supabase.from("dish_comments").select("*").order("created_at"),
  ]);
  const dishList = check(dishes, "Gerichte konnten nicht geladen werden");
  const ids = new Set(dishList.map((d) => d.id));
  if (shopping.error) console.warn("Einkaufsliste konnte nicht geladen werden", shopping.error);
  if (comments.error) console.warn("Kommentare konnten nicht geladen werden", comments.error);
  return {
    dishes: dishList,
    votes: check(votes, "Stimmen konnten nicht geladen werden").filter((v) => ids.has(v.dish_id)),
    schedule: check(schedule, "Plan konnte nicht geladen werden"),
    shopping: shopping.error ? null : shopping.data, // null = Tabelle fehlt noch
    comments: comments.error ? null : comments.data.filter((c) => ids.has(c.dish_id)), // null = Tabelle fehlt noch
  };
}

// Zutaten-Text (eine pro Zeile) <-> Liste
const toLines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50);

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
    ${data && tab === "plan" && html`<${MenuPlan} data=${data} reload=${reload} />`}
    ${data && tab === "einkauf" && html`<${ShoppingList} data=${data} reload=${reload} />`}`;
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
      // Beliebteste zuerst (👍 minus 👎), bei Gleichstand in der Reihenfolge des Vorschlags
      const score = (d) => data.votes.filter((v) => v.dish_id === d.id).reduce((s, v) => s + (v.value ?? 1), 0);
      const dishes = data.dishes.filter((d) => d.category === cat.key)
        .map((d, i) => ({ d, i, s: score(d) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.d);
      if (!dishes.length) return null;
      return html`<div class="section" key=${cat.key}>
        <h3>${cat.icon} ${cat.key}</h3>
        <div class="card list">
          ${dishes.map((d) => html`<${DishItem} key=${d.id} dish=${d} votes=${data.votes.filter((v) => v.dish_id === d.id)}
            comments=${data.comments === null ? null : data.comments.filter((c) => c.dish_id === d.id)}
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
  const [ingredients, setIngredients] = useState((dish?.ingredients || []).join("\n"));
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Bitte gib einen Namen für das Gericht ein.");
    const fields = { name: name.trim(), category, description: description.trim(), responsible, ingredients: toLines(ingredients) };
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
      <textarea maxlength="3000" rows="3" style="min-height:0" aria-label="Zutaten, eine pro Zeile"
                placeholder=${"Zutaten für die Einkaufsliste – eine pro Zeile, z. B.\n1 kg Raclettekäse\n2 kg Kartoffeln"}
                value=${ingredients} onInput=${(e) => setIngredients(e.target.value)}></textarea>
      <button class="btn primary block" disabled=${busy}>${editing ? "Speichern" : "Vorschlagen"}</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

function DishItem({ dish, votes, comments, reload, onEdit }) {
  const { me } = useApp();
  const action = useAction();
  const [showComments, setShowComments] = useState(false);
  const up = votes.filter((v) => (v.value ?? 1) === 1);
  const down = votes.filter((v) => v.value === -1);
  const mine = votes.find((v) => v.voter === me.name)?.value ?? 0; // 1, -1 oder 0

  // Gleicher Daumen nochmal = Stimme zurücknehmen; anderer Daumen = Stimme umstellen
  const vote = (value) => action.run(async () => {
    const base = supabase.from("dish_votes");
    check(mine === value
      ? await base.delete().eq("dish_id", dish.id).eq("voter", me.name)
      : mine === 0
        ? await base.insert({ dish_id: dish.id, voter: me.name, value })
        : await base.update({ value }).eq("dish_id", dish.id).eq("voter", me.name), "Stimme konnte nicht gespeichert werden");
  }).then((ok) => ok && reload());
  const names = (list) => list.map((v) => v.voter).join(", ");

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
        ${dish.ingredients?.length > 0 && html`<div class="list-sub clamp">🧾 ${dish.ingredients.join(", ")}</div>`}
        ${(up.length > 0 || down.length > 0) && html`<div class="vote-names">
          ${up.length > 0 && html`<span class="vote-up">👍 ${names(up)}</span>`}
          ${down.length > 0 && html`<span class="vote-down">👎 ${names(down)}</span>`}
        </div>`}
        <div class="list-meta">
          <${ResponsibleSelect} className="chip-select" value=${dish.responsible} disabled=${action.busy} onChange=${setResponsible} />
          <span class="muted">von ${dish.proposed_by === me.name ? "dir" : dish.proposed_by}</span>
          <button class="link-btn" disabled=${action.busy} onClick=${onEdit}>Bearbeiten</button>
          ${dish.proposed_by === me.name && html`<button class="link-btn danger" disabled=${action.busy} onClick=${remove}>Löschen</button>`}
          ${comments !== null && html`<button class="link-btn" aria-expanded=${showComments} onClick=${() => setShowComments(!showComments)}>
            💬 ${comments.length ? `Kommentare (${comments.length})` : "Kommentieren"}</button>`}
        </div>
        ${showComments && comments !== null && html`<${DishComments} dish=${dish} comments=${comments} reload=${reload} />`}
        <${Alert} kind="error">${action.error}<//>
      </div>
      <div class="votes">
        <button class=${`vote ${mine === 1 ? "on" : ""}`} disabled=${action.busy} onClick=${() => vote(1)} aria-pressed=${mine === 1}
                aria-label=${`Daumen hoch, ${up.length}`} title=${up.length ? `Dafür: ${names(up)}` : "Dafür stimmen"}>
          👍<span>${up.length}</span>
        </button>
        <button class=${`vote down ${mine === -1 ? "on" : ""}`} disabled=${action.busy} onClick=${() => vote(-1)} aria-pressed=${mine === -1}
                aria-label=${`Daumen runter, ${down.length}`} title=${down.length ? `Dagegen: ${names(down)}` : "Dagegen stimmen"}>
          👎<span>${down.length}</span>
        </button>
      </div>
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

// ---------------------------------------------------------------------------
// Einkaufsliste: Zutaten aus dem Menüplan + eigene Einträge, gemeinsam abhaken
// ---------------------------------------------------------------------------
function ShoppingList({ data, reload }) {
  const { me, season } = useApp();
  const [newItem, setNewItem] = useState("");
  const action = useAction();
  const items = data.shopping;

  if (items === null) {
    return html`<${Alert} kind="info">Die Einkaufsliste ist noch nicht eingerichtet (Datenbank-Erweiterung fehlt).<//>`;
  }

  // Zutaten aller eingeplanten Gerichte, die noch nicht auf der Liste stehen
  const plannedIds = [...new Set(data.schedule.map((s) => s.dish_id))];
  const dishById = Object.fromEntries(data.dishes.map((d) => [d.id, d]));
  const onList = new Set(items.filter((i) => i.dish_id).map((i) => `${i.dish_id}|${i.name.toLowerCase()}`));
  const missing = plannedIds.flatMap((id) => (dishById[id]?.ingredients || [])
    .filter((name) => !onList.has(`${id}|${name.toLowerCase()}`))
    .map((name) => ({ season, name, dish_id: id, added_by: me.name })));
  const plannedWithoutIngredients = plannedIds.filter((id) => dishById[id] && !(dishById[id].ingredients || []).length).length;

  const importFromPlan = () => action.run(async () => {
    check(await supabase.from("shopping_items").insert(missing), "Zutaten konnten nicht übernommen werden");
  }, `${missing.length} ${missing.length === 1 ? "Zutat" : "Zutaten"} übernommen`).then(() => reload());

  const add = (e) => {
    e.preventDefault();
    const name = newItem.trim();
    if (!name) return;
    action.run(async () => {
      check(await supabase.from("shopping_items").insert({ season, name, added_by: me.name }), "Konnte nicht hinzugefügt werden");
    }).then((ok) => { if (ok) { setNewItem(""); reload(); } });
  };

  const toggle = (item) => action.run(async () => {
    check(await supabase.from("shopping_items").update({ done: !item.done, done_by: item.done ? null : me.name }).eq("id", item.id),
      "Konnte nicht gespeichert werden");
  }).then((ok) => ok && reload());

  const remove = (item) => action.run(async () => {
    check(await supabase.from("shopping_items").delete().eq("id", item.id), "Konnte nicht gelöscht werden");
  }).then((ok) => ok && reload());

  const done = items.filter((i) => i.done);
  const clearDone = () => confirm(`${done.length} erledigte ${done.length === 1 ? "Eintrag" : "Einträge"} entfernen?`) && action.run(async () => {
    check(await supabase.from("shopping_items").delete().in("id", done.map((i) => i.id)), "Konnte nicht aufgeräumt werden");
  }, "Aufgeräumt").then((ok) => ok && reload());

  const open = items.filter((i) => !i.done);
  const source = (i) => (i.dish_id && dishById[i.dish_id] ? `für ${dishById[i.dish_id].name}` : `von ${i.added_by === me.name ? "dir" : i.added_by}`);

  return html`
    ${missing.length > 0
      ? html`<button class="btn primary block" disabled=${action.busy} onClick=${importFromPlan}>
          📥 ${missing.length} ${missing.length === 1 ? "Zutat" : "Zutaten"} aus dem Menüplan übernehmen</button>`
      : html`<p class="muted" style="margin:0 0 .5rem;font-size:.9rem">${plannedIds.length
          ? "✓ Alle Zutaten aus dem Menüplan stehen auf der Liste."
          : "Plant Gerichte im Menüplan ein und tragt bei den Gerichten Zutaten ein – dann lassen sie sich hier übernehmen."}</p>`}
    ${plannedWithoutIngredients > 0 && html`<p class="muted" style="margin:.4rem 0 0;font-size:.85rem">
      ${plannedWithoutIngredients} eingeplante${plannedWithoutIngredients === 1 ? "s Gericht hat" : " Gerichte haben"} noch keine Zutaten – unter „Vorschläge → Bearbeiten“ ergänzen.</p>`}

    <form class="inline-form add-item" novalidate onSubmit=${add} style="margin-top:.75rem">
      <input type="text" maxlength="200" placeholder="Etwas hinzufügen, z. B. Kaffee" aria-label="Neuer Eintrag"
             value=${newItem} onInput=${(e) => setNewItem(e.target.value)} />
      <button class="btn green" disabled=${action.busy || !newItem.trim()} aria-label="Hinzufügen">＋</button>
    </form>

    <div class="section" style="margin-top:1rem">
      ${open.length === 0
        ? html`<${Empty}>${items.length ? "Alles eingekauft! 🎉" : "Die Einkaufsliste ist noch leer."}<//>`
        : html`<div class="card list">${open.map((i) => html`<${ShoppingRow} key=${i.id} item=${i} sub=${source(i)}
            busy=${action.busy} onToggle=${() => toggle(i)} onRemove=${() => remove(i)} />`)}</div>`}
    </div>

    ${done.length > 0 && html`
      <div class="row between" style="margin:1.25rem 0 .5rem"><h3 style="margin:0">✓ Erledigt (${done.length})</h3>
        <button class="link-btn" disabled=${action.busy} onClick=${clearDone}>Erledigte entfernen</button></div>
      <div class="card list done-list">${done.map((i) => html`<${ShoppingRow} key=${i.id} item=${i}
          sub=${`abgehakt von ${i.done_by === me.name ? "dir" : i.done_by || "?"}`}
          busy=${action.busy} onToggle=${() => toggle(i)} onRemove=${() => remove(i)} />`)}</div>`}
    <${Alert} kind="error">${action.error}<//>`;
}

function ShoppingRow({ item, sub, busy, onToggle, onRemove }) {
  return html`
    <div class=${`list-item shop-row ${item.done ? "is-done" : ""}`}>
      <button type="button" class=${`tick ${item.done ? "on" : ""}`} role="checkbox" aria-checked=${item.done}
              aria-label=${`${item.name} ${item.done ? "nicht mehr abhaken" : "abhaken"}`} disabled=${busy} onClick=${onToggle}>
        ${item.done ? "✓" : ""}</button>
      <div class="list-main">
        <div class="list-title">${item.name}</div>
        <div class="list-sub">${sub}</div>
      </div>
      <button type="button" class="chip-x" aria-label=${`${item.name} löschen`} disabled=${busy} onClick=${onRemove}>✕</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Kommentare zu einem Gericht
// ---------------------------------------------------------------------------
function DishComments({ dish, comments, reload }) {
  const { me } = useApp();
  const [text, setText] = useState("");
  const action = useAction();

  const add = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    action.run(async () => {
      check(await supabase.from("dish_comments").insert({ dish_id: dish.id, author: me.name, text: value }), "Kommentar konnte nicht gespeichert werden");
    }).then((ok) => { if (ok) { setText(""); reload(); } });
  };

  const remove = (c) => confirm("Kommentar löschen?") && action.run(async () => {
    check(await supabase.from("dish_comments").delete().eq("id", c.id), "Kommentar konnte nicht gelöscht werden");
  }).then((ok) => ok && reload());

  return html`
    <div class="comments">
      ${comments.map((c) => html`<div class="comment" key=${c.id}>
        <div class="comment-head"><strong>${c.author === me.name ? "Du" : c.author}</strong>
          <span class="muted">${dateTime(c.created_at)}</span>
          ${c.author === me.name && html`<button class="link-btn danger" disabled=${action.busy} onClick=${() => remove(c)}>Löschen</button>`}
        </div>
        <div class="comment-text">${c.text}</div>
      </div>`)}
      <form class="inline-form add-item" novalidate onSubmit=${add}>
        <input type="text" maxlength="500" placeholder="Kommentar schreiben …" aria-label=${`Kommentar zu ${dish.name}`}
               value=${text} onInput=${(e) => setText(e.target.value)} />
        <button class="btn green small" disabled=${action.busy || !text.trim()}>Senden</button>
      </form>
      ${action.error && html`<span class="error-text">${action.error}</span>`}
    </div>`;
}
