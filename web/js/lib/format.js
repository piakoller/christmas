const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function euro(value) {
  return euroFormat.format(Number(value) || 0);
}

export function number(value) {
  return new Intl.NumberFormat("de-CH").format(value);
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function dateTime(iso) {
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Link nur anzeigen, wenn er mit http(s) beginnt (Schutz vor javascript:-Links)
export function safeUrl(url) {
  const value = (url || "").trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}
