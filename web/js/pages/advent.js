import { html, useState, useEffect, useApp, useLoader, useAction, Alert, Avatar, BackLink, Loading, Lightbox } from "../ui.js";
import { supabase, check } from "../supabase.js";
import { signedUrls } from "../lib/images.js";

const BUCKET = "advent-photos";
const FIRST_YEAR = 2000;

async function loadAdvent(season) {
  const [calendar, board] = await Promise.all([
    supabase.rpc("advent_calendar", { p_season: season }),
    supabase.rpc("advent_leaderboard", { p_season: season }),
  ]);
  return {
    doors: check(calendar, "Adventskalender konnte nicht geladen werden"),
    board: check(board, "Rangliste konnte nicht geladen werden"),
  };
}

function zurichToday() {
  // Datum in der Schweiz als YYYY-MM-DD
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
}

export function AdventPage() {
  const { season } = useApp();
  const { data, error, loading, reload } = useLoader(() => loadAdvent(season), [season]);
  const [selected, setSelected] = useState(null);

  // Standardmäßig das neueste offene Türchen auswählen
  useEffect(() => {
    if (data && selected === null) {
      const open = data.doors.filter((d) => d.is_open);
      if (open.length) setSelected(open[open.length - 1].day);
    }
  }, [data]);

  const today = zurichToday();
  const started = today >= `${season}-12-01`;
  const finished = today > `${season}-12-24`;
  const daysToStart = Math.ceil((new Date(`${season}-12-01T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
  const door = data?.doors.find((d) => d.day === selected);

  return html`
    <${BackLink} />
    <h1>🌟 Adventskalender</h1>
    <div class="card quiz-intro">
      <strong>📸 Foto-Quiz:</strong> Jeden Tag öffnet sich ein Familienfoto – <strong>rate das Jahr!</strong>
      <div class="muted" style="font-size:.9rem;margin-top:.3rem">Genau richtig 5 Punkte · 1 Jahr daneben 3 · 2 Jahre daneben 1.
        Wer am 24.12. die meisten Punkte hat, bekommt an Weihnachten das <strong>Special Gift 🎁</strong>.</div>
    </div>
    ${error && html`<${Alert} kind="error">${error.message}<//>`}
    ${loading && !data && html`<${Loading} />`}
    ${data && !started && html`<${Alert} kind="info">Das erste Türchen öffnet sich am 1. Dezember – noch ${daysToStart} ${daysToStart === 1 ? "Tag" : "Tage"}.<//>`}
    ${data && html`
      <div class="doors" role="list">
        ${data.doors.map((d) => html`<${Door} key=${d.day} door=${d} active=${d.day === selected}
          isToday=${today === `${season}-12-${String(d.day).padStart(2, "0")}`} onSelect=${() => d.is_open && setSelected(d.day)} />`)}
      </div>
      ${door && door.is_open && html`<${DoorDetail} key=${door.day} door=${door} finished=${finished} reload=${reload} />`}
      <${Leaderboard} board=${data.board} finished=${finished} />`}`;
}

function Door({ door, active, isToday, onSelect }) {
  const state = !door.is_open ? "locked" : door.my_guess != null ? "done" : "open";
  const label = !door.is_open ? `Türchen ${door.day}, noch zu`
    : door.my_guess != null ? `Türchen ${door.day}, getippt, ${door.points} Punkte` : `Türchen ${door.day}, offen`;
  return html`<button type="button" role="listitem" class=${`door ${state} ${active ? "active" : ""} ${isToday ? "today" : ""}`}
      disabled=${!door.is_open} aria-label=${label} aria-pressed=${active} onClick=${onSelect}>
    <span class="door-num">${door.day}</span>
    <span class="door-icon" aria-hidden="true">${state === "locked" ? "🔒" : state === "done" ? `+${door.points}` : "🎁"}</span>
  </button>`;
}

function DoorDetail({ door, finished, reload }) {
  const { season, me } = useApp();
  const [url, setUrl] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [guess, setGuess] = useState("");
  const { busy, error, setError, run } = useAction();
  const years = [];
  for (let y = season - 1; y >= FIRST_YEAR; y--) years.push(y);

  useEffect(() => {
    if (!door.photo_path) return;
    signedUrls(BUCKET, [door.photo_path]).then(([u]) => setUrl(u)).catch(() => setError("Foto konnte nicht geladen werden."));
  }, [door.photo_path]);

  const submit = async (e) => {
    e.preventDefault();
    if (!guess) return setError("Bitte wähle ein Jahr aus.");
    const ok = await run(async () => {
      check(await supabase.rpc("advent_guess", { p_season: season, p_day: door.day, p_guess: Number(guess) }), "Tipp konnte nicht gespeichert werden");
    });
    if (ok) reload();
  };

  const canGuess = door.my_guess == null && !finished && !me.is_family_account;
  return html`
    <div class="card door-detail">
      <h3>Türchen ${door.day}</h3>
      ${door.photo_path
        ? html`<div class="quiz-photo">${url ? html`<img src=${url} alt=${`Familienfoto hinter Türchen ${door.day}`} onClick=${() => setZoom(true)} />` : html`<${Loading} text="Foto lädt …" />`}</div>`
        : html`<p class="muted">Hinter diesem Türchen ist noch kein Foto.</p>`}
      ${canGuess && door.photo_path && html`
        <form class="inline-form guess-form" novalidate onSubmit=${submit}>
          <select value=${guess} onChange=${(e) => setGuess(e.target.value)} aria-label="Dein Tipp: aus welchem Jahr ist das Foto?">
            <option value="">Aus welchem Jahr?</option>
            ${years.map((y) => html`<option value=${y}>${y}</option>`)}
          </select>
          <button class="btn primary" disabled=${busy}>Tipp abgeben</button>
        </form>
        <small class="muted">Du hast einen Versuch. Danach siehst du die Auflösung.</small>`}
      ${door.year != null && html`<div class="reveal">
        <div class="reveal-year">📅 ${door.year}</div>
        ${door.caption && html`<div class="reveal-caption">„${door.caption}“</div>`}
        ${door.my_guess != null
          ? html`<div>Dein Tipp: <strong>${door.my_guess}</strong> → <span class=${`badge ${door.points ? "green" : ""}`}>+${door.points} ${door.points === 1 ? "Punkt" : "Punkte"}</span></div>`
          : html`<div class="muted">Du hast hier nicht getippt.</div>`}
      </div>`}
      <${Alert} kind="error">${error}<//>
      <${Lightbox} src=${zoom ? url : null} onClose=${() => setZoom(false)} />
    </div>`;
}

function Leaderboard({ board, finished }) {
  const { profileByName } = useApp();
  const best = board.length ? board[0].points : 0;
  const winners = best > 0 ? board.filter((r) => r.points === best).map((r) => r.person) : [];
  // Gleich viele Punkte = gleicher Platz (1, 2, 2, 4 …)
  const placeOf = (r) => board.filter((o) => o.points > r.points).length + 1;
  const medal = (r) => {
    if (r.points === 0) return "–";
    const place = placeOf(r);
    return place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : `${place}.`;
  };
  return html`
    <h3 style="margin:1.25rem 0 .5rem">🏆 Rangliste</h3>
    ${finished && winners.length > 0 && html`<div class="winner">
      🎉 <strong>${winners.join(" & ")}</strong> ${winners.length > 1 ? "gewinnen" : "gewinnt"} das Special Gift! 🎁</div>`}
    <div class="card list">
      ${board.map((r, i) => html`<div class="list-item rank-row" key=${r.person}>
        <span class="rank">${medal(r)}</span>
        <${Avatar} profile=${profileByName[r.person]} size="small" />
        <span class="list-main"><span class="list-title">${r.person}</span>
          <span class="list-sub">${r.guesses} ${r.guesses === 1 ? "Tipp" : "Tipps"}</span></span>
        <span class="price">${r.points} P.</span>
      </div>`)}
    </div>`;
}
