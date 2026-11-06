import { html, useApp, useLoader, visiblePages } from "../ui.js";
import { supabase } from "../supabase.js";
import { daysUntilChristmasEve } from "../lib/season.js";

async function loadStats(season, me, people) {
  const count = (q) => q.then(({ count, error }) => { if (error) throw error; return count ?? 0; });
  const [myWishes, openTasks, dishes, attendance] = await Promise.all([
    count(supabase.from("wishes").select("id", { count: "exact", head: true }).eq("season", season).eq("owner", me.name)),
    count(supabase.from("purchases").select("item_id", { count: "exact", head: true }).eq("season", season).eq("claimed_by", me.name).eq("purchased", false)),
    count(supabase.from("dishes").select("id", { count: "exact", head: true }).eq("season", season)),
    supabase.from("attendance").select("person").eq("season", season)
      .then(({ data, error }) => { if (error) throw error; return data.filter((r) => people.some((p) => p.name === r.person)).length; }),
  ]);
  return { myWishes, openTasks, dishes, attendance };
}

function adventStat(today = new Date()) {
  if (today.getMonth() === 11 && today.getDate() <= 24) return `Heute ist Türchen ${today.getDate()} dran`;
  if (today.getMonth() === 11) return "Alle 24 Türchen sind offen";
  const start = new Date(today.getFullYear(), 11, 1);
  return `Startet in ${Math.ceil((start - today) / 86400000)} Tagen`;
}

const TILES = {
  wunschliste: { tint: "#FCE8E6", stat: (s) => `${s.myWishes} eigene Wünsche · ${s.openTasks} offene Besorgungen` },
  essen: { tint: "#E6F2EA", stat: (s) => `${s.dishes} Gerichte vorgeschlagen` },
  anwesenheit: { tint: "#E7EEF8", stat: (s, n) => `${s.attendance} von ${n} haben sich eingetragen` },
  advent: { tint: "#FFF4D6", stat: () => adventStat() },
};

export function DashboardPage() {
  const { me, season, people, settings } = useApp();
  const days = daysUntilChristmasEve();
  const { data: stats, error } = useLoader(() => loadStats(season, me, people), [season, me.name]);
  const tiles = visiblePages(settings).filter((p) => TILES[p.key]);

  return html`
    <div class="hero">
      <div>
        <h1>Hallo ${me.name}! 👋</h1>
        <p>Schön, dass du da bist. Hier planen wir zusammen Weihnachten ${season}.</p>
      </div>
      <a class="count" href="#/countdown" style="color:inherit;text-decoration:none">
        <div class="num">${days}</div>
        <div class="lbl">${days === 1 ? "Tag" : "Tage"} bis Heiligabend</div>
      </a>
    </div>
    ${error && html`<div class="alert error">Übersicht konnte nicht geladen werden: ${error.message}</div>`}
    <div class="grid">
      ${tiles.map((p) => html`
        <a class="card tile" href=${`#/${p.key}`}>
          <div class="tile-head">
            <div class="tile-icon" style=${{ background: TILES[p.key].tint }} aria-hidden="true">${p.icon}</div>
            <div class="tile-title">${p.label}</div>
          </div>
          <div class="tile-stat">${stats ? TILES[p.key].stat(stats, people.length) : "…"}</div>
        </a>`)}
    </div>`;
}
