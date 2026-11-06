// Saison = das Weihnachten, das gerade geplant wird.
// Im Januar zählt noch das vergangene Weihnachten, ab Februar das neue.
export function currentSeasonYear(today = new Date()) {
  return today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
}

export const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

const DAY_LABELS = {
  23: ["23. Dezember", "🎄"],
  24: ["Heiligabend (24.12.)", "🎄"],
  25: ["1. Weihnachtstag (25.12.)", "🎅"],
  26: ["2. Weihnachtstag (26.12.)", "🎁"],
};

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Geplante Tage (Essen, Anwesenheit) mit Wochentag
export function christmasDays(season) {
  return Object.entries(DAY_LABELS).map(([day, [label, emoji]]) => {
    const date = new Date(season, 11, Number(day));
    return { date: isoDate(season, 12, Number(day)), name: `${label}, ${WEEKDAYS[date.getDay()]}`, emoji };
  });
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Nächster Heiligabend (heute zählt noch, ab dem 25.12. der nächste)
export function nextChristmasEve(today = new Date()) {
  const eve = new Date(today.getFullYear(), 11, 24);
  return startOfDay(today) > eve ? new Date(today.getFullYear() + 1, 11, 24) : eve;
}

export function daysUntilChristmasEve(today = new Date()) {
  return Math.round((nextChristmasEve(today) - startOfDay(today)) / 86400000);
}
