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
  { key: "meine", label: "🎁 Meine Wünsche" },
  { key: "andere", label: "🎄 Wünsche der Anderen" },
  { key: "vorschlaege", label: "💡 Geheime Vorschläge" },
  { key: "besorgungen", label: "🛒 Besorgungen & Ausgaben" },
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
function GiftDetails({ item, images = true }) {
  const link = safeUrl(item.link);
  return html`
    ${item.description && html`<p style="white-space:pre-line">${item.description}</p>`}
    ${link && html`<p><a href=${link} target="_blank" rel="noopener noreferrer">🔗 Link öffnen</a></p>`}
    ${images && item.image_paths?.length > 0 && html`<${StoredImages} bucket=${BUCKET} paths=${item.image_paths} />`}`;
}

function PriceTag({ value }) {
  return Number(value) > 0 ? html`<span class="badge">${euro(value)}</span>` : null;
}

function PurchaseForm({ itemId, estimate, reload, onDone }) {
  const [price, setPrice] = useState(estimate > 0 ? String(estimate) : "");
  const { busy, error, setError, run } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const value = parsePrice(price);
    if (Number.isNaN(value)) return setError("Bitte gib einen gültigen Preis ein.");
    if (await run(() => markPurchased(itemId, value), "Als gekauft markiert")) { onDone?.(); reload(); }
  };
  return html`
    <form class="row" novalidate onSubmit=${submit} style="margin-top:.5rem">
      <input type="number" step="0.01" min="0" inputmode="decimal" style="max-width:140px"
             aria-label="Tatsächlicher Preis in Euro" placeholder="Preis in €" value=${price}
             onInput=${(e) => setPrice(e.target.value)} />
      <button class="btn green small" disabled=${busy}>✓ Als gekauft markieren</button>
      <${Alert} kind="error">${error}<//>
    </form>`;
}

// Besorgen / nicht mehr besorgen / gekauft – für Wünsche anderer und Vorschläge
function ClaimControls({ item, kind, purchase, reload }) {
  const { me } = useApp();
  const action = useAction();
  if (!purchase) {
    return html`<div class="row" style="margin-top:.5rem">
      <button class="btn primary small" disabled=${action.busy}
        onClick=${() => action.run(() => claim(item.id, kind, me.name), "Super! Du besorgst das.").then((ok) => ok && reload())}>
        🎁 Ich besorge das!
      </button>
      <${Alert} kind="error">${action.error}<//>
    </div>`;
  }
  if (purchase.claimed_by !== me.name) {
    return html`<p style="margin-top:.5rem"><span class="badge gold">Wird von ${purchase.claimed_by} besorgt</span></p>`;
  }
  return html`<div style="margin-top:.5rem">
    ${purchase.purchased
      ? html`<span class="badge green">✅ Von dir gekauft${purchase.actual_price != null ? ` (${euro(purchase.actual_price)})` : ""}</span>`
      : html`<span class="badge gold">🛍️ Du besorgst das</span>
             <${PurchaseForm} itemId=${item.id} estimate=${Number(item.price)} reload=${reload} />`}
    ${!purchase.purchased && html`<div style="margin-top:.4rem">
      <button class="btn ghost small" disabled=${action.busy}
        onClick=${() => confirm("Wirklich nicht mehr besorgen? Dann können es andere übernehmen.")
          && action.run(() => unclaim(item.id), "Freigegeben").then((ok) => ok && reload())}>
        ↩︎ Nicht mehr besorgen
      </button></div>`}
    <${Alert} kind="error">${action.error}<//>
  </div>`;
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function PersonHeading({ name, children }) {
  const { profileByName } = useApp();
  return html`<h2 class="row" style="margin-top:1.5rem"><${Avatar} profile=${profileByName[name]} size="small" />${children || name}</h2>`;
}

// ---------------------------------------------------------------------------
// Meine Wünsche
// ---------------------------------------------------------------------------
function MyWishes({ data, reload }) {
  const { me } = useApp();
  const [editing, setEditing] = useState(null); // null = neuer Wunsch, Objekt = bearbeiten
  const [formKey, setFormKey] = useState(0);
  const mine = data.wishes.filter((w) => w.owner === me.name);
  const total = mine.reduce((sum, w) => sum + Number(w.price || 0), 0);
  const limit = CONFIG.budgetLimit;
  const pct = Math.min(100, (total / limit) * 100);
  const color = total > limit ? "var(--red)" : pct > 80 ? "#E0A100" : "#3B8F5A";

  const startEdit = (wish) => { setEditing(wish); setFormKey((k) => k + 1); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const done = () => { setEditing(null); setFormKey((k) => k + 1); reload(); };

  return html`
    <div class="card">
      <div class="row between"><strong>Dein Budget</strong><span>${euro(total)} von ${euro(limit)}</span></div>
      <div class="progress" style="margin-top:.5rem"><div style=${{ width: `${pct}%`, background: color }}></div></div>
      <small>Gerechnet mit den geschätzten Preisen deiner Wünsche.</small>
    </div>
    <div class="section">
      <${WishForm} key=${formKey} wish=${editing} mine=${mine} onDone=${done} onCancel=${() => { setEditing(null); setFormKey((k) => k + 1); }} />
    </div>
    <div class="section">
      <h2>Meine Wunschliste</h2>
      ${mine.length === 0 && html`<${Empty}>Du hast noch keine Wünsche eingetragen.<//>`}
      ${mine.map((w) => html`<${MyWishCard} key=${w.id} wish=${w} purchase=${data.purchases.find((p) => p.item_id === w.id)}
                                onEdit=${() => startEdit(w)} reload=${reload} />`)}
    </div>`;
}

function MyWishCard({ wish, purchase, onEdit, reload }) {
  const del = useAction();
  const undo = useAction();
  const { me } = useApp();
  const selfBought = purchase && purchase.claimed_by === me.name;

  const remove = () => confirm(`„${wish.name}“ wirklich löschen?`)
    && del.run(() => deleteWish(wish), "Wunsch gelöscht").then((ok) => ok && reload());

  return html`
    <div class="card">
      <div class="row between">
        <h3>${wish.name}</h3>
        <${PriceTag} value=${wish.price} />
      </div>
      <div class="row" style="gap:.4rem;margin-bottom:.5rem">
        ${wish.buy_self ? html`<span class="badge">🛍️ Kaufe ich selbst</span>` : html`<span class="badge">🎁 Andere dürfen es kaufen</span>`}
        ${wish.expert && html`<span class="badge">👨‍🏫 Experte: ${wish.expert}</span>`}
      </div>
      <${GiftDetails} item=${wish} />
      ${wish.buy_self && (selfBought
        ? html`<p><span class="badge green">✅ Schon besorgt${purchase.actual_price != null ? ` (${euro(purchase.actual_price)})` : ""}</span>
            <button class="btn ghost small" disabled=${undo.busy}
              onClick=${() => undo.run(() => unclaim(wish.id), "Zurückgesetzt").then((ok) => ok && reload())}>Rückgängig</button></p>`
        : html`<${SelfBuyForm} wish=${wish} reload=${reload} />`)}
      <div class="row" style="margin-top:.75rem">
        <button class="btn small" onClick=${onEdit}>✏️ Bearbeiten</button>
        <button class="btn small danger" disabled=${del.busy} onClick=${remove}>🗑️ Löschen</button>
      </div>
      <${Alert} kind="error">${del.error || undo.error}<//>
    </div>`;
}

function SelfBuyForm({ wish, reload }) {
  const { me } = useApp();
  const [price, setPrice] = useState(Number(wish.price) > 0 ? String(wish.price) : "");
  const { busy, error, setError, run } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const value = parsePrice(price);
    if (Number.isNaN(value)) return setError("Bitte gib einen gültigen Preis ein.");
    if (await run(() => claim(wish.id, "wish", me.name, true, value), "Als gekauft markiert")) reload();
  };
  return html`
    <form class="row" novalidate onSubmit=${submit}>
      <input type="number" step="0.01" min="0" inputmode="decimal" style="max-width:140px"
             aria-label="Tatsächlicher Preis in Euro" placeholder="Preis in €" value=${price} onInput=${(e) => setPrice(e.target.value)} />
      <button class="btn green small" disabled=${busy}>✓ Als gekauft markieren</button>
      <${Alert} kind="error">${error && error.includes("schon jemand") ? "Das geht gerade nicht. Frag am besten Dieter oder Gudrun." : error}<//>
    </form>`;
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
    <details class="box" open=${editing || mine.length === 0}>
      <summary>${editing ? "✏️ Wunsch bearbeiten" : "➕ Neuen Wunsch hinzufügen"}</summary>
      <form class="form" novalidate onSubmit=${submit}>
        <label class="field"><span>Was wünschst du dir?</span>
          <input type="text" maxlength="200" value=${name} onInput=${(e) => setName(e.target.value)} />
        </label>
        <label class="field"><span>Beschreibung</span>
          <textarea maxlength="2000" placeholder="Größe, Farbe, Modell …" value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
        </label>
        <div class="form-row">
          <label class="field"><span>Link (optional)</span>
            <input type="text" inputmode="url" autocapitalize="off" placeholder="https://…" value=${link} onInput=${(e) => setLink(e.target.value)} />
          </label>
          <label class="field"><span>Geschätzter Preis (€)</span>
            <input type="number" step="0.01" min="0" inputmode="decimal" value=${price} onInput=${(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="field" style="font-weight:600;font-size:.9rem;margin-bottom:.3rem">Wer soll es besorgen?</legend>
          <label class="check"><input type="radio" name="buy" checked=${!buySelf} onChange=${() => setBuySelf(false)} /> Andere dürfen es kaufen</label>
          <label class="check"><input type="radio" name="buy" checked=${buySelf} onChange=${() => setBuySelf(true)} /> Ich kaufe es selbst</label>
        </fieldset>
        <label class="field"><span>Experte (optional)</span>
          <select value=${expert} onChange=${(e) => setExpert(e.target.value)}>
            <option value="">– niemand –</option>
            ${experts.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
          </select>
          <small>Der Experte kümmert sich um diesen Wunsch und bekommt eine Benachrichtigung.</small>
        </label>
        ${kept.length > 0 && html`<div>
          <div class="field" style="font-weight:600;font-size:.9rem">Vorhandene Bilder</div>
          <div class="row">${kept.map((p) => html`
            <span class="row" style="gap:.25rem">
              <${StoredImages} bucket=${BUCKET} paths=${[p]} />
              <button type="button" class="btn ghost small danger" onClick=${() => setKept(kept.filter((x) => x !== p))}>Entfernen</button>
            </span>`)}</div>
        </div>`}
        <label class="field"><span>Bilder hinzufügen (optional)</span>
          <input type="file" accept="image/*" multiple onChange=${(e) => setFiles([...e.target.files])} />
        </label>
        <div class="row">
          <button class="btn primary" disabled=${busy}>${busy ? "Speichern …" : editing ? "💾 Speichern" : "➕ Wunsch hinzufügen"}</button>
          ${editing && html`<button type="button" class="btn ghost" onClick=${onCancel}>Abbrechen</button>`}
        </div>
        <${Alert} kind="error">${error}<//>
      </form>
    </details>`;
}

// ---------------------------------------------------------------------------
// Wünsche der Anderen (+ Expertenaufträge)
// ---------------------------------------------------------------------------
function OthersWishes({ data, reload }) {
  const { me, profiles } = useApp();
  const purchaseOf = (id) => data.purchases.find((p) => p.item_id === id);
  const expertTasks = data.wishes.filter((w) => w.expert === me.name);
  const others = data.wishes.filter((w) => w.owner !== me.name && !w.buy_self);
  const grouped = groupBy(others, "owner");
  const order = profiles.map((p) => p.name).filter((n) => grouped.has(n));

  return html`
    ${expertTasks.length > 0 && html`
      <h2>👨‍🏫 Meine Expertenaufträge</h2>
      <p class="muted">Bei diesen Wünschen bist du als Experte eingetragen.</p>
      ${expertTasks.map((w) => html`
        <div class="card" key=${w.id}>
          <div class="row between"><h3>${w.name} <small>für ${w.owner}</small></h3><${PriceTag} value=${w.price} /></div>
          ${w.buy_self && html`<span class="badge">${w.owner} kauft es eigentlich selbst</span>`}
          <${GiftDetails} item=${w} />
          <${ClaimControls} item=${w} kind="wish" purchase=${purchaseOf(w.id)} reload=${reload} />
        </div>`)}`}
    ${order.length === 0 && html`<${Empty}>Es gibt derzeit keine Wünsche von anderen.<//>`}
    ${order.map((owner) => html`
      <${PersonHeading} name=${owner}>Wünsche von ${owner}<//>
      ${grouped.get(owner).map((w) => html`
        <div class="card" key=${w.id}>
          <div class="row between"><h3>${w.name}</h3><${PriceTag} value=${w.price} /></div>
          ${w.expert && html`<span class="badge">👨‍🏫 Experte: ${w.expert}</span>`}
          <${GiftDetails} item=${w} />
          <${ClaimControls} item=${w} kind="wish" purchase=${purchaseOf(w.id)} reload=${reload} />
        </div>`)}`)}`;
}

// ---------------------------------------------------------------------------
// Geheime Vorschläge
// ---------------------------------------------------------------------------
function Suggestions({ data, reload }) {
  const { me, profiles } = useApp();
  const [editing, setEditing] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const purchaseOf = (id) => data.purchases.find((p) => p.item_id === id);
  const grouped = groupBy(data.suggestions, "suggested_for");
  const order = profiles.map((p) => p.name).filter((n) => grouped.has(n));
  const del = useAction();

  const startEdit = (s) => { setEditing(s); setFormKey((k) => k + 1); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const done = () => { setEditing(null); setFormKey((k) => k + 1); reload(); };

  return html`
    <${Alert} kind="info">🤫 Vorschläge sind für alle sichtbar, nur nicht für die Person, für die sie gedacht sind.<//>
    <div class="section">
      <${SuggestionForm} key=${formKey} suggestion=${editing} onDone=${done}
        onCancel=${() => { setEditing(null); setFormKey((k) => k + 1); }} />
    </div>
    ${order.length === 0 && html`<div class="section"><${Empty}>Noch keine Vorschläge.<//></div>`}
    ${order.map((person) => html`
      <${PersonHeading} name=${person}>Ideen für ${person}<//>
      ${grouped.get(person).map((s) => html`
        <div class="card" key=${s.id}>
          <div class="row between"><h3>${s.name}</h3><${PriceTag} value=${s.price} /></div>
          <small>Vorgeschlagen von ${s.suggested_by === me.name ? "dir" : s.suggested_by}</small>
          <${GiftDetails} item=${s} />
          <${ClaimControls} item=${s} kind="suggestion" purchase=${purchaseOf(s.id)} reload=${reload} />
          ${s.suggested_by === me.name && html`<div class="row" style="margin-top:.75rem">
            <button class="btn small" onClick=${() => startEdit(s)}>✏️ Bearbeiten</button>
            <button class="btn small danger" disabled=${del.busy}
              onClick=${() => confirm(`Vorschlag „${s.name}“ löschen?`) && del.run(() => deleteSuggestion(s.id), "Vorschlag gelöscht").then((ok) => ok && reload())}>
              🗑️ Löschen</button>
          </div>`}
        </div>`)}`)}
    <${Alert} kind="error">${del.error}<//>`;
}

function SuggestionForm({ suggestion, onDone, onCancel }) {
  const { me, season, profiles } = useApp();
  const editing = Boolean(suggestion);
  const targets = profiles.filter((p) => p.name !== me.name);
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
    }, editing ? "Vorschlag gespeichert" : `Geheimer Vorschlag für ${target} gespeichert`);
    if (ok) {
      if (!editing) notify("suggestion", saved.id).catch(console.warn);
      onDone();
    }
  };

  return html`
    <details class="box" open=${editing}>
      <summary>${editing ? "✏️ Vorschlag bearbeiten" : "💡 Geheimen Geschenkvorschlag machen"}</summary>
      <form class="form" novalidate onSubmit=${submit}>
        <label class="field"><span>Für wen?</span>
          <select value=${target} onChange=${(e) => setTarget(e.target.value)}>
            ${targets.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
          </select>
        </label>
        <label class="field"><span>Geschenkidee</span>
          <input type="text" maxlength="200" value=${name} onInput=${(e) => setName(e.target.value)} />
        </label>
        <label class="field"><span>Beschreibung / Warum ist das eine gute Idee?</span>
          <textarea maxlength="2000" value=${description} onInput=${(e) => setDescription(e.target.value)}></textarea>
        </label>
        <div class="form-row">
          <label class="field"><span>Link (optional)</span>
            <input type="text" inputmode="url" autocapitalize="off" placeholder="https://…" value=${link} onInput=${(e) => setLink(e.target.value)} />
          </label>
          <label class="field"><span>Ungefährer Preis (€)</span>
            <input type="number" step="0.01" min="0" inputmode="decimal" value=${price} onInput=${(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <div class="row">
          <button class="btn primary" disabled=${busy}>${editing ? "💾 Speichern" : "💡 Vorschlag speichern"}</button>
          ${editing && html`<button type="button" class="btn ghost" onClick=${onCancel}>Abbrechen</button>`}
        </div>
        <${Alert} kind="error">${error}<//>
      </form>
    </details>`;
}

// ---------------------------------------------------------------------------
// Besorgungen & Ausgaben
// ---------------------------------------------------------------------------
function Shopping({ data, reload }) {
  const { me, profiles } = useApp();
  const mine = data.purchases.filter((p) => p.claimed_by === me.name && p.recipient !== me.name);
  const open = mine.filter((p) => !p.purchased);
  const bought = mine.filter((p) => p.purchased);
  const spent = bought.reduce((s, p) => s + Number(p.actual_price || 0), 0);
  const reimbursed = bought.filter((p) => p.reimbursed).reduce((s, p) => s + Number(p.actual_price || 0), 0);
  const itemOf = (p) => (p.item_kind === "wish" ? data.wishes : data.suggestions).find((x) => x.id === p.item_id);

  return html`
    <h2>📋 Noch zu besorgen</h2>
    ${open.length === 0 && html`<${Empty}>Nichts offen. 🎉<//>`}
    ${open.map((p) => html`<${OpenPurchase} key=${p.item_id} purchase=${p} item=${itemOf(p)} reload=${reload} />`)}

    <div class="section">
      <h2>💰 Meine Ausgaben</h2>
      <div class="metrics">
        <div class="metric"><div class="label">Ausgegeben</div><div class="value">${euro(spent)}</div></div>
        <div class="metric"><div class="label">Erstattet</div><div class="value">${euro(reimbursed)}</div></div>
        <div class="metric"><div class="label">Offen</div><div class="value">${euro(spent - reimbursed)}</div></div>
      </div>
      ${bought.length > 0 && html`<${BoughtTable} rows=${bought} itemOf=${itemOf} reload=${reload} />`}
    </div>

    ${me.is_admin && html`<${AdminSpending} data=${data} profiles=${profiles} />`}`;
}

function OpenPurchase({ purchase, item, reload }) {
  const action = useAction();
  return html`
    <div class="card">
      <div class="row between"><h3>${purchase.item_name} <small>für ${purchase.recipient}</small></h3>
        ${item ? html`<${PriceTag} value=${item.price} />` : html`<span class="badge red">Wunsch wurde gelöscht</span>`}</div>
      ${item && html`<${GiftDetails} item=${item} images=${false} />`}
      <${PurchaseForm} itemId=${purchase.item_id} estimate=${Number(item?.price || 0)} reload=${reload} />
      <button class="btn ghost small" style="margin-top:.4rem" disabled=${action.busy}
        onClick=${() => confirm("Wirklich nicht mehr besorgen?") && action.run(() => unclaim(purchase.item_id), "Freigegeben").then((ok) => ok && reload())}>
        ↩︎ Nicht mehr besorgen</button>
      <${Alert} kind="error">${action.error}<//>
    </div>`;
}

function BoughtTable({ rows, reload }) {
  const action = useAction();
  return html`
    <div class="table-wrap" style="margin-top:1rem">
      <table class="simple">
        <thead><tr><th>Geschenk</th><th>Für</th><th>Preis</th><th>Erstattet</th><th></th></tr></thead>
        <tbody>
          ${rows.map((p) => html`<tr key=${p.item_id}>
            <td>${p.item_name}</td>
            <td>${p.recipient}</td>
            <td>${euro(p.actual_price)}</td>
            <td><label class="check"><input type="checkbox" checked=${p.reimbursed} disabled=${action.busy}
              onChange=${(e) => action.run(() => setReimbursed(p.item_id, e.target.checked)).then((ok) => ok && reload())} />
              ${p.reimbursed ? "Ja" : "Nein"}</label></td>
            <td><button class="btn ghost small" disabled=${action.busy}
              onClick=${() => confirm("Kauf rückgängig machen?") && action.run(() => undoPurchased(p.item_id), "Zurückgesetzt").then((ok) => ok && reload())}>
              Rückgängig</button></td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <${Alert} kind="error">${action.error}<//>`;
}

function AdminSpending({ data, profiles }) {
  const { me } = useApp();
  // Käufe für mich selbst sind für mich unsichtbar (Überraschung) – also nur sichtbare zeigen
  const bought = data.purchases.filter((p) => p.purchased && p.claimed_by !== me.name && p.recipient !== p.claimed_by);
  const byBuyer = groupBy(bought, "claimed_by");
  const order = profiles.map((p) => p.name).filter((n) => byBuyer.has(n));
  return html`
    <div class="section">
      <h2>👑 Ausgaben aller</h2>
      <p class="muted">Nur Käufe, die nicht für dich sind.</p>
      ${order.length === 0 && html`<${Empty}>Noch keine Käufe.<//>`}
      ${order.map((buyer) => {
        const rows = byBuyer.get(buyer);
        const sum = rows.reduce((s, p) => s + Number(p.actual_price || 0), 0);
        const paid = rows.filter((p) => p.reimbursed).reduce((s, p) => s + Number(p.actual_price || 0), 0);
        return html`<details class="box" style="margin-top:.6rem" key=${buyer}>
          <summary>${buyer}: ${euro(sum)} ausgegeben, ${euro(sum - paid)} offen</summary>
          <div class="table-wrap"><table class="simple">
            <thead><tr><th>Geschenk</th><th>Für</th><th>Preis</th><th>Erstattet</th></tr></thead>
            <tbody>${rows.map((p) => html`<tr key=${p.item_id}><td>${p.item_name}</td><td>${p.recipient}</td>
              <td>${euro(p.actual_price)}</td><td>${p.reimbursed ? "✅" : "–"}</td></tr>`)}</tbody>
          </table></div>
        </details>`;
      })}
    </div>`;
}
