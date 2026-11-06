// Datenzugriff für Wünsche, Vorschläge und Besorgungen
import { supabase, check } from "../supabase.js";
import { uploadImages, removeImages } from "./images.js";

export const BUCKET = "wish-images";

export async function loadGifts(season) {
  const [wishes, suggestions, purchases] = await Promise.all([
    supabase.from("wishes").select("*").eq("season", season).order("created_at"),
    supabase.from("suggestions").select("*").eq("season", season).order("created_at"),
    supabase.from("purchases").select("*").eq("season", season).order("claimed_at"),
  ]);
  return {
    wishes: check(wishes, "Wünsche konnten nicht geladen werden"),
    suggestions: check(suggestions, "Vorschläge konnten nicht geladen werden"),
    purchases: check(purchases, "Besorgungen konnten nicht geladen werden"),
  };
}

function friendly(error, fallback) {
  if (!error) return null;
  if (error.code === "23505") return new Error("Das besorgt schon jemand anderes.");
  return new Error(`${fallback}. ${error.message || ""}`.trim());
}

// ---- Wünsche ----
export async function saveWish({ id, season, owner, fields, newFiles, keptPaths, removedPaths }) {
  const added = newFiles?.length ? await uploadImages(BUCKET, owner, newFiles) : [];
  const row = { ...fields, image_paths: [...(keptPaths || []), ...added], updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("wishes").update(row).eq("id", id).select().single()
    : await supabase.from("wishes").insert({ ...row, season, owner }).select().single();
  if (result.error) {
    await removeImages(BUCKET, added);
    throw friendly(result.error, "Wunsch konnte nicht gespeichert werden");
  }
  await removeImages(BUCKET, removedPaths);
  return result.data;
}

export async function deleteWish(wish) {
  check(await supabase.from("wishes").delete().eq("id", wish.id), "Wunsch konnte nicht gelöscht werden");
  await removeImages(BUCKET, wish.image_paths);
}

// ---- Geheime Vorschläge ----
export async function saveSuggestion({ id, season, by, fields }) {
  const result = id
    ? await supabase.from("suggestions").update(fields).eq("id", id).select().single()
    : await supabase.from("suggestions").insert({ ...fields, season, suggested_by: by }).select().single();
  if (result.error) throw friendly(result.error, "Vorschlag konnte nicht gespeichert werden");
  return result.data;
}

export async function deleteSuggestion(id) {
  check(await supabase.from("suggestions").delete().eq("id", id), "Vorschlag konnte nicht gelöscht werden");
}

// ---- Besorgungen ----
export async function claim(itemId, kind, me, purchased = false, actualPrice = null) {
  const { error } = await supabase.from("purchases").insert({
    item_id: itemId, item_kind: kind, claimed_by: me, purchased, actual_price: actualPrice,
    // werden in der Datenbank aus dem Geschenk übernommen:
    season: 0, recipient: me, item_name: "",
  });
  if (error) throw friendly(error, "Das hat nicht geklappt");
}

export async function unclaim(itemId) {
  check(await supabase.from("purchases").delete().eq("item_id", itemId), "Das hat nicht geklappt");
}

export async function markPurchased(itemId, actualPrice) {
  check(await supabase.from("purchases").update({ purchased: true, actual_price: actualPrice }).eq("item_id", itemId),
    "Kauf konnte nicht gespeichert werden");
}

export async function undoPurchased(itemId) {
  check(await supabase.from("purchases").update({ purchased: false, actual_price: null, reimbursed: false }).eq("item_id", itemId),
    "Das hat nicht geklappt");
}

export async function setReimbursed(itemId, value) {
  check(await supabase.from("purchases").update({ reimbursed: value }).eq("item_id", itemId), "Das hat nicht geklappt");
}

export function parsePrice(value) {
  const n = Number(String(value ?? "").replace(",", ".").trim() || 0);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
