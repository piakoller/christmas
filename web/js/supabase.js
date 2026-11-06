import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config.js";

// "Angemeldet bleiben": an = Sitzung im localStorage (bleibt nach dem Schließen),
// aus = sessionStorage (weg, sobald der Tab geschlossen wird).
const REMEMBER_KEY = "xmas_remember";

function remember() {
  try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return false; }
}

export function setRemember(value) {
  try { localStorage.setItem(REMEMBER_KEY, value ? "1" : "0"); } catch { /* privater Modus */ }
}

const storage = {
  getItem(key) {
    try { return localStorage.getItem(key) ?? sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try {
      (remember() ? localStorage : sessionStorage).setItem(key, value);
      (remember() ? sessionStorage : localStorage).removeItem(key);
    } catch { /* privater Modus */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const isConfigured = !CONFIG.supabaseUrl.includes("DEIN-PROJEKT");

// Einheitliche Fehlerbehandlung für Abfragen: wirft mit deutscher Meldung
export function check({ data, error }, message = "Das hat nicht geklappt") {
  if (error) {
    console.error(message, error);
    throw new Error(`${message}. ${error.message || ""}`.trim());
  }
  return data;
}
