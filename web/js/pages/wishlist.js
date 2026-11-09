import { html, useState, useApp, useLoader, useAction, navigate, Alert, Avatar, BackLink, Loading, Empty } from "../ui.js";
import { CONFIG } from "../../config.js";
import { euro, safeUrl } from "../lib/format.js";
import { StoredImages } from "../lib/images.js";
import { notify } from "../lib/push.js";
import {
  BUCKET, loadGifts, saveWish, deleteWish, saveSuggestion, deleteSuggestion,
  claim, unclaim, markPurchased, undoPurchased, setReimbursed, parsePrice,
} from "../lib/gifts.js";

const TABS = [
  { key: "meine", label: "🎁 Meine" },
  { key: "andere", label: "🎄 Andere" },
  { key: "vorschlaege", label: "🤫 Ideen" },
  { key: "besorgungen", label: "🛒 Einkäufe" },
];

export function WishlistPage({ params }) {
  const { season } = useApp();
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab : "meine";
  const { data, error, loading, reload } = useLoader(() => loadGifts(season), [season]);

  return html`
    <${BackLink} />
    <h1>🎁 Wunschliste</h1>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => html`<button role="tab" aria-selected=${tab === t.key} class=${tab === t.key ? "active" : ""}
        onClick=${() => navigate("wunschliste", { tab: t.key })}>${t.label}</button>`)}
    </div>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && tab === "meine" && html`<${MyWishes} data=${data} reload=${reload} />`}
    ${data && tab === "andere" && html`<${OthersWishes} data=${data} reload=${reload} />`}
    ${data && tab === "vorschlaege" && html`<${Suggestions} data=${data} reload=${reload} />`}
    ${data && tab === "besorgungen" && html`<${Shopping} data=${data} reload=${reload} />`}`;
}

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------
function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item[key])) map.set(item[key], []);
    map.get(item[key]).push(item);
  }
  return map;
}

function PersonHeading({ name, children }) {
  const { profileByName } = useApp();
  return html`<h3 class="row" style="gap:.5rem;margin:1.25rem 0 .5rem"><${Avatar} profile=${profileByName[name]} size="small" />${children || name}</h3>`;
}

// Ein Geschenk als Listeneintrag: Titel + Preis rechts, darunter Text, Link, Bilder, Extras
function GiftItem({ item, extra, children }) {
  const link = safeUrl(item.link);
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${item.name}</div>
        ${item.description && html`<div class="list-sub clamp">${item.description}</div>`}
        ${(link || extra) && html`<div class="list-meta">
          ${extra}
          ${link && html`<a href=${link} target="_blank" rel="noopener noreferrer">🔗 Link</a>`}
        </div>`}
        ${item.image_paths?.length > 0 && html`<${StoredImages} bucket=${BUCKET} paths=${item.image_paths} small />`}
        ${children}
      </div>
      ${Number(item.price) > 0 && html`<div class="price">${euro(item.price)}</div>`}
    </div>`;
}

function PriceForm({ estimate, onSubmit, busy, label = "✓ Gekauft" }) {
  const [price, setPrice] = useState(estimate > 0 ? String(estimate) : "");
  const [error, setError] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const value = parsePrice(price);
    if (Number.isNaN(value)) return setError("Bitte gib einen gültigen Preis ein.");
    setError("");
    onSubmit(value);
  };
  return html`
    <form class="inline-form" novalidate onSubmit=${submit}>
      <input type="number" step="0.01" min="0" inputmode="decimal" aria-label="Bezahlter Preis in Euro"
             placeholder="Preis €" value=${price} onInput=${(e) => setPrice(e.target.value)} />
      <button class="btn green small" disabled=${busy}>${label}</button>
      ${error && html`<span class="error-text">${error}</span>`}
    </form>`;
}

// Besorgen / nicht mehr besorgen / als gekauft markieren
function ClaimControls({ item, kind, purchase, reload }) {
  const { me } = useApp();
  const action = useAction();
  const run = (fn, text) => action.run(fn, text).then((ok) => ok && reload());

  let body;
  if (!purchase) {
    body = html`<button class="btn primary small" disabled=${action.busy}
      onClick=${() => run(() => claim(item.id, kind, me.name), "Super! Du besorgst das.")}>🎁 Besorge ich</button>`;
  } else if (purchase.claimed_by !== me.name) {
    body = html`<span class="badge gold">🔒 ${purchase.claimed_by} besorgt das</span>`;
  } else if (purchase.purchased) {
    body = html`<span class="badge green">✅ Von dir gekauft${purchase.actual_price != null ? ` · ${euro(purchase.actual_price)}` : ""}</span>`;
  } else {
    body = html`
      <span class="badge gold">🛍️ Du besorgst das</span>
      <${PriceForm} estimate=${Number(item.price)} busy=${action.busy}
        onSubmit=${(value) => run(() => markPurchased(item.id, value), "Als gekauft markiert")} />
      <button class="link-btn" disabled=${action.busy}
        onClick=${() => confirm("Wirklich nicht mehr besorgen? Dann können es andere übernehmen.")
          && run(() => unclaim(item.id), "Freigegeben")}>Nicht mehr besorgen</button>`;
  }
  return html`<div class="item-actions">${body}</div>${action.error && html`<span class="error-text">${action.error}</span>`}`;
}

// Kleines Formular, das sich erst auf Knopfdruck öffnet
function Collapsible({ open, onOpen, buttonLabel, children }) {
  if (!open) return html`<button class="btn primary block" onClick=${onOpen}>${buttonLabel}</button>`;
  return children;
}

function FormHeader({ title, onClose }) {
  return html`<div class="row between"><h3 style="margin:0">${title}</h3>
    <button type="button" class="btn ghost small" onClick=${onClose} aria-label="Schließen">✕</button></div>`;
}

// ---------------------------------------------------------------------------
// Meine Wünsche
// ---------------------------------------------------------------------------
function MyWishes({ data, reload }) {
  const { me } = useApp();
  const [editing, setEditing] = useState(null); // null = zu, "new" = neuer Wunsch, Objekt = bearbeiten
  const mine = data.wishes.filter((w) => w.owner === me.name);
  const total = mine.reduce((sum, w) => sum + Number(w.price || 0), 0);
  const limit = CONFIG.budgetLimit;
  const pct = Math.min(100, (total / limit) * 100);
  const color = total > limit ? "var(--red)" : pct > 80 ? "#E0A100" : "#3B8F5A";

  const edit = (wish) => { setEditing(wish); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const done = () => { setEditing(null); reload(); };

  return html`
    <div class="budget">
      <div class="row between"><span>Budget</span><strong>${euro(total)} / ${euro(limit)}</strong></div>
      <div class="progress"><div style=${{ width: `${pct}%`, background: color }}></div></div>
    </div>
    <${Collapsible} open=${editing !== null} onOpen=${() => setEditing("new")} buttonLabel="➕ Wunsch hinzufügen">
      <${WishForm} key=${editing?.id || "new"} wish=${editing === "new" ? null : editing} mine=${mine}
        onDone=${done} onCancel=${() => setEditing(null)} />
    <//>
    <div class="section">
      ${mine.length === 0
        ? html`<${Empty}>Du hast noch keine Wünsche eingetragen.<//>`
        : html`<div class="card list">${mine.map((w) => html`<${MyWishItem} key=${w.id} wish=${w}
            purchase=${data.purchases.find((p) => p.item_id === w.id)} onEdit=${() => edit(w)} reload=${reload} />`)}</div>`}
    </div>`;
}

function MyWishItem({ wish, purchase, onEdit, reload }) {
  const { me } = useApp();
  const action = useAction();
  const run = (fn, text) => action.run(fn, text).then((ok) => ok && reload());
  const selfBought = purchase && purchase.claimed_by === me.name;

  const extra = html`
    ${wish.buy_self ? html`<span class="badge">🛍️ Kaufe ich selbst</span>` : null}
    ${wish.expert ? html`<span class="badge">👨‍🏫 ${wish.expert}</span>` : null}`;

  return html`
    <${GiftItem} item=${wish} extra=${extra}>
      ${wish.buy_self && html`<div class="item-actions">
        ${selfBought
          ? html`<span class="badge green">✅ Gekauft${purchase.actual_price != null ? ` · ${euro(purchase.actual_price)}` : ""}</span>
                 <button class="link-btn" disabled=${action.busy} onClick=${() => run(() => unclaim(wish.id), "Zurückgesetzt")}>Rückgängig</button>`
          : html`<${PriceForm} estimate=${Number(wish.price)} busy=${action.busy} label="✓ Selbst gekauft"
                   onSubmit=${(value) => run(() => claim(wish.id, "wish", me.name, true, value), "Als gekauft markiert")} />`}
      </div>`}
      <div class="item-links">
        <button class="link-btn" onClick=${onEdit}>Bearbeiten</button>
        <button class="link-btn danger" disabled=${action.busy}
          onClick=${() => confirm(`„${wish.name}“ wirklich löschen?`) && run(() => deleteWish(wish), "Wunsch gelöscht")}>Löschen</button>
      </div>
      ${action.error && html`<span class="error-text">${action.error.includes("schon jemand") ? "Das geht gerade nicht. Frag am besten Pia." : action.error}</span>`}
    <//>`;
}

function WishForm({ wish, mine, onDone, onCancel }) {
  const { me, season, people } = useApp();
  const editing = Boolean(wish);
  const [name, setName] = useState(wish?.name || "");
  const [description, setDescription] = useState(wish?.description || "");
  const [link, setLink] = useState(wish?.link || "");
  const [price, setPrice] = useState(wish ? String(wish.price) : "");
  const [buySelf, setBuySelf] = useState(wish?.buy_self || false);
  const [expert, setExpert] = useState(wish?.expert || "");
  const [kept, setKept] = useState(wish?.image_paths || []);
  const [files, setFiles] = useState([]);
  const { busy, error, setError, run } = useAction();
  const experts = people.filter((p) => p.name !== me.name);

  const submit = async (e) => {
    e.preventDefault();
    const value = parsePrice(price);
    if (!name.trim()) return setError("Bitte gib einen Namen für deinen Wunsch ein.");
    if (!description.trim()) return setError("Bitte füge eine Beschreibung hinzu.");
    if (Number.isNaN(value)) return setError("Bitte gib einen gültigen Preis ein.");
    const others = mine.filter((w) => w.id !== wish?.id).reduce((s, w) => s + Number(w.price || 0), 0);
    if (others + value > CONFIG.budgetLimit) {
      return setError(`Dieser Wunsch würde dein Budget von ${euro(CONFIG.budgetLimit)} überschreiten. Du hast noch ${euro(Math.max(0, CONFIG.budgetLimit - others))} verfügbar.`);
    }
    const removed = (wish?.image_paths || []).filter((p) => !kept.includes(p));
    let saved = null;
    const ok = await run(async () => {
      saved = await saveWish({
        id: wish?.id, season, owner: me.name,
        fields: { name: name.trim(), description: description.trim(), link: link.trim(), price: value, buy_self: buySelf, expert: expert || null },
        newFiles: files, keptPaths: kept, removedPaths: removed,
      });
    }, editing ? "Wunsch gespeichert" : `Wunsch „${name.trim()}“ hinzugefügt`);
    if (ok) {
      if (saved.expert && saved.expert !== wish?.expert) notify("expert", saved.id).catch(console.warn);
      onDone();
    }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <${FormHeader} title=${editing ? "Wunsch bearbeiten" : "Neuer Wunsch"} onClose=${onCancel} />
      <input type="text" maxlength="200" placeholder="Was wünschst du dir?" aria-label="Wunsch"
             value=${name} onInput=${(e) => setName(e.target.value)} />
      <textarea maxlength="2000" rows="2" style="min-height:0" placeholder="Beschreibung: Größe, Farbe, Modell …" aria-label="Beschreibung"
                value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
      <div class="form-row tight">
        <input type="text" inputmode="url" autocapitalize="off" placeholder="Link (optional)" aria-label="Link"
               value=${link} onInput=${(e) => setLink(e.target.value)} />
        <input type="number" step="0.01" min="0" inputmode="decimal" placeholder="Preis €" aria-label="Geschätzter Preis in Euro"
               value=${price} onInput=${(e) => setPrice(e.target.value)} />
      </div>
      <div class="segmented two" role="radiogroup" aria-label="Wer kauft es?">
        <button type="button" role="radio" aria-checked=${!buySelf} class=${!buySelf ? "on" : ""} onClick=${() => setBuySelf(false)}>🎁 Andere kaufen</button>
        <button type="button" role="radio" aria-checked=${buySelf} class=${buySelf ? "on" : ""} onClick=${() => setBuySelf(true)}>🛍️ Kaufe ich selbst</button>
      </div>
      <div class="row" style="gap:.5rem">
        <select class="chip-select" value=${expert} onChange=${(e) => setExpert(e.target.value)} aria-label="Experte">
          <option value="">👨‍🏫 Experte (optional)</option>
          ${experts.map((p) => html`<option value=${p.name}>👨‍🏫 ${p.name}</option>`)}
        </select>
        <label class="chip file-chip">📷 ${files.length ? `${files.length} Bild${files.length > 1 ? "er" : ""}` : "Bilder"}
          <input type="file" accept="image/*" multiple onChange=${(e) => setFiles([...e.target.files])} />
        </label>
      </div>
      ${kept.length > 0 && html`<div class="row" style="gap:.4rem">${kept.map((p) => html`
        <span class="thumb-edit"><${StoredImages} bucket=${BUCKET} paths=${[p]} small />
          <button type="button" class="chip-x" aria-label="Bild entfernen" onClick=${() => setKept(kept.filter((x) => x !== p))}>✕</button></span>`)}
      </div>`}
      <button class="btn primary block" disabled=${busy}>${busy ? "Speichern …" : editing ? "Speichern" : "Wunsch hinzufügen"}</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

// ---------------------------------------------------------------------------
// Wünsche der Anderen (+ Expertenaufträge)
// ---------------------------------------------------------------------------
function OthersWishes({ data, reload }) {
  const { me, profiles } = useApp();
  const purchaseOf = (id) => data.purchases.find((p) => p.item_id === id);
  const expertTasks = data.wishes.filter((w) => w.expert === me.name);
  const grouped = groupBy(data.wishes.filter((w) => w.owner !== me.name && !w.buy_self), "owner");
  const order = profiles.map((p) => p.name).filter((n) => grouped.has(n));

  return html`
    ${expertTasks.length > 0 && html`
      <h3 style="margin:.25rem 0 .5rem">👨‍🏫 Du bist Experte</h3>
      <div class="card list">${expertTasks.map((w) => html`<${GiftItem} key=${w.id} item=${w}
          extra=${html`<span class="muted">für ${w.owner}</span>${w.buy_self ? html`<span class="badge">kauft es selbst</span>` : null}`}>
        <${ClaimControls} item=${w} kind="wish" purchase=${purchaseOf(w.id)} reload=${reload} />
      <//>`)}</div>`}
    ${order.length === 0 && html`<${Empty}>Es gibt noch keine Wünsche von anderen.<//>`}
    ${order.map((owner) => html`
      <${PersonHeading} name=${owner} />
      <div class="card list">${grouped.get(owner).map((w) => html`<${GiftItem} key=${w.id} item=${w}
          extra=${w.expert ? html`<span class="badge">👨‍🏫 ${w.expert}</span>` : null}>
        <${ClaimControls} item=${w} kind="wish" purchase=${purchaseOf(w.id)} reload=${reload} />
      <//>`)}</div>`)}`;
}

// ---------------------------------------------------------------------------
// Geheime Vorschläge
// ---------------------------------------------------------------------------
// Für wen kann ich Ideen machen? Alle außer mir – und Gruppen nur, wenn ich nicht dazugehöre
function suggestionTargets(me, profiles, groups) {
  return [
    ...profiles.filter((p) => p.name !== me.name),
    ...groups.filter((g) => !g.members.includes(me.name)),
  ];
}

function targetLabel(name, profileByName) {
  const p = profileByName[name];
  return p?.is_group && p.members?.length ? `${name} (${p.members.join(", ")})` : name;
}

function Suggestions({ data, reload }) {
  const { me, profiles, groups, profileByName } = useApp();
  const [editing, setEditing] = useState(null);
  const purchaseOf = (id) => data.purchases.find((p) => p.item_id === id);
  const grouped = groupBy(data.suggestions, "suggested_for");
  const order = [...profiles, ...groups].map((p) => p.name).filter((n) => grouped.has(n));
  const del = useAction();

  const edit = (s) => { setEditing(s); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const done = () => { setEditing(null); reload(); };

  return html`
    <p class="muted" style="margin:0 0 .75rem">🤫 Ideen sind für alle sichtbar – nur nicht für die Person (bzw. die Eltern oder Kinder), für die sie gedacht sind.</p>
    <${Collapsible} open=${editing !== null} onOpen=${() => setEditing("new")} buttonLabel="💡 Idee vorschlagen">
      <${SuggestionForm} key=${editing?.id || "new"} suggestion=${editing === "new" ? null : editing}
        onDone=${done} onCancel=${() => setEditing(null)} />
    <//>
    ${order.length === 0 && html`<div class="section"><${Empty}>Noch keine Ideen.<//></div>`}
    ${order.map((person) => html`
      <${PersonHeading} name=${person}>Für ${targetLabel(person, profileByName)}<//>
      <div class="card list">${grouped.get(person).map((s) => html`<${GiftItem} key=${s.id} item=${s}
          extra=${html`<span class="muted">von ${s.suggested_by === me.name ? "dir" : s.suggested_by}</span>`}>
        <${ClaimControls} item=${s} kind="suggestion" purchase=${purchaseOf(s.id)} reload=${reload} />
        ${s.suggested_by === me.name && html`<div class="item-links">
          <button class="link-btn" onClick=${() => edit(s)}>Bearbeiten</button>
          <button class="link-btn danger" disabled=${del.busy}
            onClick=${() => confirm(`Idee „${s.name}“ löschen?`) && del.run(() => deleteSuggestion(s.id), "Idee gelöscht").then((ok) => ok && reload())}>Löschen</button>
        </div>`}
      <//>`)}</div>`)}
    <${Alert} kind="error">${del.error}<//>`;
}

function SuggestionForm({ suggestion, onDone, onCancel }) {
  const { me, season, profiles, groups, profileByName } = useApp();
  const editing = Boolean(suggestion);
  const targets = suggestionTargets(me, profiles, groups);
  const [target, setTarget] = useState(suggestion?.suggested_for || targets[0]?.name || "");
  const [name, setName] = useState(suggestion?.name || "");
  const [description, setDescription] = useState(suggestion?.description || "");
  const [link, setLink] = useState(suggestion?.link || "");
  const [price, setPrice] = useState(suggestion ? String(suggestion.price) : "");
  const { busy, error, setError, run } = useAction();

  const submit = async (e) => {
    e.preventDefault();
    const value = parsePrice(price);
    if (!name.trim()) return setError("Bitte gib die Geschenkidee ein.");
    if (!description.trim()) return setError("Bitte beschreibe kurz, warum das eine gute Idee ist.");
    if (Number.isNaN(value)) return setError("Bitte gib einen gültigen Preis ein.");
    let saved = null;
    const ok = await run(async () => {
      saved = await saveSuggestion({
        id: suggestion?.id, season, by: me.name,
        fields: { suggested_for: target, name: name.trim(), description: description.trim(), link: link.trim(), price: value },
      });
    }, editing ? "Idee gespeichert" : `Geheime Idee für ${target} gespeichert`);
    if (ok) {
      if (!editing) notify("suggestion", saved.id).catch(console.warn);
      onDone();
    }
  };

  return html`
    <form class="card form" novalidate onSubmit=${submit}>
      <${FormHeader} title=${editing ? "Idee bearbeiten" : "Neue geheime Idee"} onClose=${onCancel} />
      <select class="chip-select" value=${target} onChange=${(e) => setTarget(e.target.value)} aria-label="Für wen?">
        ${targets.map((p) => html`<option value=${p.name}>Für ${targetLabel(p.name, profileByName)}</option>`)}
      </select>
      <input type="text" maxlength="200" placeholder="Geschenkidee" aria-label="Geschenkidee"
             value=${name} onInput=${(e) => setName(e.target.value)} />
      <textarea maxlength="2000" rows="2" style="min-height:0" placeholder="Warum ist das eine gute Idee?" aria-label="Beschreibung"
                value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
      <div class="form-row tight">
        <input type="text" inputmode="url" autocapitalize="off" placeholder="Link (optional)" aria-label="Link"
               value=${link} onInput=${(e) => setLink(e.target.value)} />
        <input type="number" step="0.01" min="0" inputmode="decimal" placeholder="Preis €" aria-label="Ungefährer Preis in Euro"
               value=${price} onInput=${(e) => setPrice(e.target.value)} />
      </div>
      <button class="btn primary block" disabled=${busy}>${editing ? "Speichern" : "Idee speichern"}</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

// ---------------------------------------------------------------------------
// Einkäufe & Ausgaben
// ---------------------------------------------------------------------------
function Shopping({ data, reload }) {
  const { me, profiles, groups } = useApp();
  // Die Übersicht "Ausgaben aller" ist für die Eltern (Dieter & Gudrun), nicht an die Admin-Rolle gebunden
  const isParent = groups.some((g) => g.name === "Eltern" && g.members.includes(me.name));
  const mine = data.purchases.filter((p) => p.claimed_by === me.name && p.recipient !== me.name);
  const open = mine.filter((p) => !p.purchased);
  const bought = mine.filter((p) => p.purchased);
  const spent = bought.reduce((s, p) => s + Number(p.actual_price || 0), 0);
  const reimbursed = bought.filter((p) => p.reimbursed).reduce((s, p) => s + Number(p.actual_price || 0), 0);
  const itemOf = (p) => (p.item_kind === "wish" ? data.wishes : data.suggestions).find((x) => x.id === p.item_id);

  return html`
    <div class="metrics three">
      <div class="metric"><div class="label">Ausgegeben</div><div class="value">${euro(spent)}</div></div>
      <div class="metric"><div class="label">Erstattet</div><div class="value">${euro(reimbursed)}</div></div>
      <div class="metric"><div class="label">Offen</div><div class="value">${euro(spent - reimbursed)}</div></div>
    </div>

    <h3 style="margin:1.25rem 0 .5rem">📋 Noch zu besorgen</h3>
    ${open.length === 0
      ? html`<${Empty}>Nichts offen. 🎉<//>`
      : html`<div class="card list">${open.map((p) => html`<${OpenPurchase} key=${p.item_id} purchase=${p} item=${itemOf(p)} reload=${reload} />`)}</div>`}

    ${bought.length > 0 && html`
      <h3 style="margin:1.25rem 0 .5rem">✅ Gekauft</h3>
      <div class="card list">${bought.map((p) => html`<${BoughtItem} key=${p.item_id} purchase=${p} reload=${reload} />`)}</div>`}

    ${isParent && html`<${AdminSpending} data=${data} profiles=${profiles} />`}`;
}

function OpenPurchase({ purchase, item, reload }) {
  const action = useAction();
  const run = (fn, text) => action.run(fn, text).then((ok) => ok && reload());
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${purchase.item_name}</div>
        <div class="list-meta"><span class="muted">für ${purchase.recipient}</span>
          ${!item && html`<span class="badge red">Wunsch wurde gelöscht</span>`}</div>
        <div class="item-actions">
          <${PriceForm} estimate=${Number(item?.price || 0)} busy=${action.busy}
            onSubmit=${(value) => run(() => markPurchased(purchase.item_id, value), "Als gekauft markiert")} />
          <button class="link-btn" disabled=${action.busy}
            onClick=${() => confirm("Wirklich nicht mehr besorgen?") && run(() => unclaim(purchase.item_id), "Freigegeben")}>Nicht mehr besorgen</button>
        </div>
        ${action.error && html`<span class="error-text">${action.error}</span>`}
      </div>
      ${item && Number(item.price) > 0 && html`<div class="price">${euro(item.price)}</div>`}
    </div>`;
}

function BoughtItem({ purchase, reload }) {
  const action = useAction();
  const run = (fn, text) => action.run(fn, text).then((ok) => ok && reload());
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${purchase.item_name}</div>
        <div class="list-meta">
          <span class="muted">für ${purchase.recipient}</span>
          <button type="button" class=${`chip ${purchase.reimbursed ? "on" : ""}`} aria-pressed=${purchase.reimbursed} disabled=${action.busy}
            onClick=${() => run(() => setReimbursed(purchase.item_id, !purchase.reimbursed))}>
            ${purchase.reimbursed ? "✓ Erstattet" : "Nicht erstattet"}</button>
          <button class="link-btn" disabled=${action.busy}
            onClick=${() => confirm("Kauf rückgängig machen?") && run(() => undoPurchased(purchase.item_id), "Zurückgesetzt")}>Rückgängig</button>
        </div>
        ${action.error && html`<span class="error-text">${action.error}</span>`}
      </div>
      <div class="price">${euro(purchase.actual_price)}</div>
    </div>`;
}

function AdminSpending({ data, profiles }) {
  const { me } = useApp();
  // Käufe für mich selbst sind für mich unsichtbar (Überraschung) – also nur sichtbare zeigen
  const bought = data.purchases.filter((p) => p.purchased && p.claimed_by !== me.name && p.recipient !== p.claimed_by);
  const byBuyer = groupBy(bought, "claimed_by");
  const order = profiles.map((p) => p.name).filter((n) => byBuyer.has(n));
  return html`
    <h3 style="margin:1.5rem 0 .25rem">👑 Ausgaben aller</h3>
    <p class="muted" style="margin:0 0 .5rem;font-size:.9rem">Nur Käufe, die nicht für dich sind.</p>
    ${order.length === 0
      ? html`<${Empty}>Noch keine Käufe.<//>`
      : html`<div class="card list">${order.map((buyer) => {
          const rows = byBuyer.get(buyer);
          const sum = rows.reduce((s, p) => s + Number(p.actual_price || 0), 0);
          const paid = rows.filter((p) => p.reimbursed).reduce((s, p) => s + Number(p.actual_price || 0), 0);
          return html`<details class="list-item details-item" key=${buyer}>
            <summary><span class="list-title">${buyer}</span><span class="muted"> · ${euro(sum - paid)} offen</span><span class="price">${euro(sum)}</span></summary>
            ${rows.map((p) => html`<div class="row between sub-row" key=${p.item_id}>
              <span>${p.item_name} <span class="muted">für ${p.recipient}</span></span>
              <span>${euro(p.actual_price)} ${p.reimbursed ? "✓" : ""}</span></div>`)}
          </details>`;
        })}</div>`}`;
}
