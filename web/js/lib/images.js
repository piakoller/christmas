import { supabase, check } from "../supabase.js";
import { html, useState, useEffect, Lightbox } from "../ui.js";

const MAX_WIDTH = 800;
const QUALITY = 0.85;

// Verkleinert ein Foto im Browser auf max. 800 px Breite (JPEG 85 %, weißer Hintergrund)
export async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Bild konnte nicht verarbeitet werden"))), "image/jpeg", QUALITY));
}

// Lädt Bilder in den Ordner der Person hoch und gibt die Speicherpfade zurück
export async function uploadImages(bucket, folder, files) {
  const paths = [];
  for (const file of files) {
    const blob = await resizeImage(file);
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    check(await supabase.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg" }), "Bild konnte nicht hochgeladen werden");
    paths.push(path);
  }
  return paths;
}

export async function removeImages(bucket, paths) {
  if (!paths?.length) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) console.warn("Bilder konnten nicht gelöscht werden", error);
}

// Signierte (zeitlich begrenzte) Links für private Bilder, mit kleinem Zwischenspeicher
const urlCache = new Map();
export async function signedUrls(bucket, paths) {
  const now = Date.now();
  const missing = paths.filter((p) => !(urlCache.get(`${bucket}/${p}`)?.expires > now));
  if (missing.length) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, 3600);
    if (error) throw error;
    for (const item of data) {
      if (item.signedUrl) urlCache.set(`${bucket}/${item.path}`, { url: item.signedUrl, expires: now + 50 * 60 * 1000 });
    }
  }
  return paths.map((p) => urlCache.get(`${bucket}/${p}`)?.url).filter(Boolean);
}

export function StoredImages({ bucket, paths }) {
  const [urls, setUrls] = useState([]);
  const [open, setOpen] = useState(null);
  const key = (paths || []).join("|");
  useEffect(() => {
    if (!paths?.length) { setUrls([]); return; }
    signedUrls(bucket, paths).then(setUrls).catch((e) => console.warn(e));
  }, [key]);
  if (!urls.length) return null;
  return html`
    <div class="images">
      ${urls.map((u) => html`<img src=${u} alt="Bild zum Wunsch" loading="lazy" onClick=${() => setOpen(u)} />`)}
    </div>
    <${Lightbox} src=${open} onClose=${() => setOpen(null)} />`;
}
