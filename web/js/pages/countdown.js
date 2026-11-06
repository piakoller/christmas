import { html, useState, useEffect, BackLink } from "../ui.js";
import { nextChristmasEve, daysUntilChristmasEve, WEEKDAYS } from "../lib/season.js";
import { number } from "../lib/format.js";

export function CountdownPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const eve = nextChristmasEve(now);
  const days = daysUntilChristmasEve(now);
  const seconds = Math.max(0, Math.floor((eve - now) / 1000));

  return html`
    <${BackLink} />
    <div class="hero centered" style="padding:3rem 2rem">
      <div style="font-size:3rem;line-height:1" aria-hidden="true">🎅</div>
      <div class="num" style="font-size:5rem">${days}</div>
      <div class="lbl" style="font-size:1.3rem">${days === 1 ? "Tag" : "Tage"} bis Heiligabend</div>
      <p>${WEEKDAYS[eve.getDay()]}, 24. Dezember ${eve.getFullYear()}</p>
    </div>
    <div class="metrics">
      <div class="metric"><div class="label">Wochen</div><div class="value">${(days / 7).toFixed(1).replace(".", ",")}</div></div>
      <div class="metric"><div class="label">Stunden</div><div class="value">${number(Math.floor(seconds / 3600))}</div></div>
      <div class="metric"><div class="label">Minuten</div><div class="value">${number(Math.floor(seconds / 60))}</div></div>
      <div class="metric"><div class="label">Sekunden</div><div class="value">${number(seconds)}</div></div>
    </div>
    <div class="section">
      <h3>🎄 Die schönste Zeit des Jahres steht bevor!</h3>
      <p class="muted">Nutze die Wunschliste, um deine Wünsche zu teilen, und plant gemeinsam die Feiertage.</p>
    </div>`;
}
