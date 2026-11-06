// Gemeinsame Bausteine für alle Seiten
import { createContext } from "preact";
import { useContext, useState, useEffect, useCallback } from "preact/hooks";
import { html } from "htm/preact";

export { html, useState, useEffect, useCallback };

// App-weiter Zustand: angemeldete Person, alle Personen, Saison, Einstellungen, Toast
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const PAGES = [
  { key: "", icon: "🏠", label: "Übersicht" },
  { key: "wunschliste", icon: "🎁", label: "Wunschliste" },
  { key: "essen", icon: "🍽️", label: "Essensplanung" },
  { key: "anwesenheit", icon: "📅", label: "Wer kommt wann?" },
  { key: "advent", icon: "🌟", label: "Adventskalender", flag: "advent_calendar" },
  { key: "countdown", icon: "⏰", label: "Countdown" },
  { key: "einstellungen", icon: "⚙️", label: "Einstellungen" },
];

export function visiblePages(settings) {
  return PAGES.filter((p) => !p.flag || settings?.[p.flag] === true);
}

export function navigate(key, params = {}) {
  const query = new URLSearchParams(params).toString();
  location.hash = `#/${key}${query ? `?${query}` : ""}`;
}

export function Alert({ kind = "info", children }) {
  if (!children) return null;
  return html`<div class=${`alert ${kind}`} role=${kind === "error" ? "alert" : "status"}>${children}</div>`;
}

export function Avatar({ profile, size = "" }) {
  if (!profile) return null;
  return html`<span class=${`avatar ${size}`} style=${{ background: profile.color_bg, color: profile.color_fg }}
    aria-hidden="true">${profile.name[0].toUpperCase()}</span>`;
}

export function BackLink() {
  return html`<a class="back" href="#/">← Zur Übersicht</a>`;
}

export function Loading({ text = "Lädt …" }) {
  return html`<div class="loading">${text}</div>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

// Lädt Daten mit einer async-Funktion; reload() lädt neu (z. B. nach dem Speichern)
export function useLoader(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => { cancelled = true; };
  }, [...deps, tick]);
  // Beim Zurückkehren in die App frische Daten holen (andere haben evtl. etwas geändert)
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// Führt eine Aktion aus und zeigt Fehler/Erfolg; verhindert Doppelklicks
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn, successText) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (successText) toast(successText);
      return true;
    } catch (e) {
      setError(e.message || String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return html`<div class="overlay" onClick=${onClose} role="dialog" aria-label="Bild">
    <img src=${src} alt="" />
  </div>`;
}
