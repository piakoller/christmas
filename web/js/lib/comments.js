// Kommentar-Liste mit Eingabefeld, gemeinsam für Gerichte (dish_comments) und Wünsche (wish_comments)
import { html, useState, useApp, useAction } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { dateTime } from "./format.js";

// table: Tabellenname, column: Spalte mit der ID des Eintrags (dish_id / wish_id)
// highlight: Name, dessen Beiträge hervorgehoben werden (z. B. Besitzer des Wunsches)
// onAdded(id): wird nach dem Speichern mit der ID des neuen Kommentars aufgerufen
export function Comments({ table, column, itemId, itemName, comments, reload, placeholder = "Kommentar schreiben …", highlight, highlightLabel, onAdded }) {
  const { me } = useApp();
  const [text, setText] = useState("");
  const action = useAction();

  const add = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    let id = null;
    action.run(async () => {
      const row = check(await supabase.from(table).insert({ [column]: itemId, author: me.name, text: value }).select("id").single(),
        "Kommentar konnte nicht gespeichert werden");
      id = row?.id;
    }).then((ok) => {
      if (!ok) return;
      setText("");
      if (id && onAdded) onAdded(id);
      reload();
    });
  };

  const remove = (c) => confirm("Kommentar löschen?") && action.run(async () => {
    check(await supabase.from(table).delete().eq("id", c.id), "Kommentar konnte nicht gelöscht werden");
  }).then((ok) => ok && reload());

  return html`
    <div class="comments">
      ${comments.map((c) => html`<div class=${`comment ${highlight && c.author === highlight ? "highlight" : ""}`} key=${c.id}>
        <div class="comment-head"><strong>${c.author === me.name ? "Du" : c.author}</strong>
          ${highlight && c.author === highlight && highlightLabel && html`<span class="badge">${highlightLabel}</span>`}
          <span class="muted">${dateTime(c.created_at)}</span>
          ${c.author === me.name && html`<button class="link-btn danger" disabled=${action.busy} onClick=${() => remove(c)}>Löschen</button>`}
        </div>
        <div class="comment-text">${c.text}</div>
      </div>`)}
      <form class="inline-form add-item" novalidate onSubmit=${add}>
        <input type="text" maxlength="500" placeholder=${placeholder} aria-label=${`Kommentar zu ${itemName}`}
               value=${text} onInput=${(e) => setText(e.target.value)} />
        <button class="btn green small" disabled=${action.busy || !text.trim()}>Senden</button>
      </form>
      ${action.error && html`<span class="error-text">${action.error}</span>`}
    </div>`;
}
