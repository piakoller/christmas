import { supabase, setRemember, check } from "./supabase.js";
import { CONFIG } from "../config.js";
import { forgetDeviceOnLogout } from "./lib/push.js";

// Jede Person ist ein Supabase-Login mit einer festen Kunst-Adresse.
export function emailFor(name) {
  const slug = name.normalize("NFKD").replace(/[^\w]/g, "").toLowerCase();
  return `${slug}@${CONFIG.authEmailDomain}`;
}

// Supabase verlangt mindestens 6 Zeichen; die PIN selbst hat 4–8 Ziffern.
function pinToPassword(pin) {
  return `xmas-${pin.trim()}`;
}

export function isValidPin(pin) {
  return /^\d{4,8}$/.test((pin || "").trim());
}

export async function loadLoginProfiles() {
  return check(await supabase.rpc("login_profiles"), "Personen konnten nicht geladen werden");
}

export async function login(name, pin, remember) {
  setRemember(remember);
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(name), password: pinToPassword(pin) });
  if (error) {
    if (/rate limit|too many/i.test(error.message)) {
      throw new Error("Zu viele Versuche. Bitte warte ein paar Minuten.");
    }
    throw new Error("Falsche PIN. Versuch es nochmal.");
  }
}

export async function setupPin(name, familyCode, pin, remember) {
  setRemember(remember);
  const { data, error } = await supabase.auth.signUp({
    email: emailFor(name),
    password: pinToPassword(pin),
    options: { data: { name, family_code: familyCode.trim() } },
  });
  if (error) {
    if (/rate limit|too many/i.test(error.message)) {
      throw new Error("Zu viele Versuche. Bitte warte ein paar Minuten.");
    }
    // Die Datenbank meldet bewusst nur allgemein, ob es geklappt hat.
    throw new Error("Das hat nicht geklappt: Ist der Familien-Code richtig?");
  }
  if (!data.session) {
    throw new Error("Die PIN wurde gespeichert, aber die Anmeldung braucht eine E-Mail-Bestätigung. Bitte in Supabase die E-Mail-Bestätigung ausschalten.");
  }
}

export async function changePin(name, oldPin, newPin) {
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(name), password: pinToPassword(oldPin) });
  if (error) throw new Error("Die aktuelle PIN stimmt nicht.");
  check(await supabase.auth.updateUser({ password: pinToPassword(newPin) }), "PIN konnte nicht geändert werden");
  // Andere Geräte abmelden
  await supabase.auth.signOut({ scope: "others" });
}

export async function resetPin(person) {
  check(await supabase.rpc("admin_reset_pin", { person }), "PIN konnte nicht zurückgesetzt werden");
}

export async function logout() {
  await forgetDeviceOnLogout(); // keine Nachrichten mehr für diese Person auf diesem Gerät
  await supabase.auth.signOut({ scope: "local" });
}

// Profil der angemeldeten Person (Name, Admin, Familienkonto)
export async function loadMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("auth_id", userId).maybeSingle();
  if (error) throw new Error("Profil konnte nicht geladen werden");
  return data;
}
