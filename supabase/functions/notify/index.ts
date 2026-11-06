// Edge Function "notify": verschickt Push-Nachrichten.
// Die App ruft sie nach dem Speichern auf: { kind: "expert" | "meal" | "suggestion" | "test", id }.
// Die Funktion liest den Datensatz selbst (Service-Key), bestimmt die Empfänger, beachtet
// deren Einstellungen und schickt jede Nachricht nur einmal (Tabelle notifications_sent).
//
// Secrets (Supabase Dashboard → Edge Functions → Secrets, oder `npx supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (z. B. "mailto:du@example.com")
// SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Pref = "expert" | "meal" | "suggestion";
type Message = { recipients: string[]; pref: Pref | null; title: string; body: string; url: string; tag: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Wer ruft auf?
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Nicht angemeldet" }, 401);
  const { data: caller } = await admin.from("profiles").select("name").eq("auth_id", userData.user.id).maybeSingle();
  if (!caller) return json({ error: "Unbekannte Person" }, 403);

  let payload: { kind?: string; id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }

  const message = await buildMessage(admin, caller.name, payload.kind ?? "", payload.id ?? "");
  if ("error" in message) return json({ error: message.error }, 400);

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:weihnachten@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  let sent = 0;
  for (const recipient of message.recipients) {
    if (message.pref) {
      const { data: prefs } = await admin.from("notification_prefs").select("*").eq("person", recipient).maybeSingle();
      if (prefs && prefs[message.pref] === false) continue;
      // Jede Nachricht nur einmal pro Person und Ereignis
      const { error: dup } = await admin.from("notifications_sent")
        .insert({ kind: payload.kind, item_id: payload.id, recipient });
      if (dup) continue;
    }
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("person", recipient);
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag }),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); // Gerät abgemeldet
        } else {
          console.error("Push fehlgeschlagen", status, err);
        }
      }
    }
  }
  return json({ sent });
});

// deno-lint-ignore no-explicit-any
async function buildMessage(admin: any, caller: string, kind: string, id: string): Promise<Message | { error: string }> {
  if (kind === "test") {
    return { recipients: [caller], pref: null, title: "🎄 Test", body: "Benachrichtigungen funktionieren!", url: "./#/einstellungen", tag: "test" };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Ungültige ID" };

  if (kind === "expert") {
    const { data: wish } = await admin.from("wishes").select("owner, expert").eq("id", id).maybeSingle();
    if (!wish || wish.owner !== caller || !wish.expert) return { error: "Nicht gefunden" };
    return {
      recipients: [wish.expert], pref: "expert", tag: `expert-${id}`,
      title: "👨‍🏫 Neuer Expertenauftrag",
      body: `${wish.owner} hat dich als Experte für einen Wunsch eingetragen.`,
      url: "./#/wunschliste?tab=andere",
    };
  }
  if (kind === "meal") {
    const { data: dish } = await admin.from("dishes").select("name, responsible").eq("id", id).maybeSingle();
    if (!dish?.responsible || dish.responsible === caller) return { error: "Nicht gefunden" };
    return {
      recipients: [dish.responsible], pref: "meal", tag: `meal-${id}`,
      title: "🍽️ Essen zugeteilt",
      body: `${caller} hat dich eingetragen für: ${dish.name}`,
      url: "./#/essen",
    };
  }
  if (kind === "suggestion") {
    const { data: s } = await admin.from("suggestions").select("suggested_by, suggested_for").eq("id", id).maybeSingle();
    if (!s || s.suggested_by !== caller) return { error: "Nicht gefunden" };
    const { data: people } = await admin.from("profiles").select("name").eq("is_family_account", false).eq("is_group", false);
    // Ist die Idee für eine Gruppe (Eltern/Kinder), erfährt kein Mitglied davon
    const { data: members } = await admin.from("group_members").select("member").eq("group_name", s.suggested_for);
    const excluded = new Set([s.suggested_for, s.suggested_by, ...(members ?? []).map((m: { member: string }) => m.member)]);
    const recipients = (people ?? []).map((p: { name: string }) => p.name).filter((n: string) => !excluded.has(n));
    return {
      recipients, pref: "suggestion", tag: `suggestion-${id}`,
      title: "🤫 Neue geheime Geschenkidee",
      body: `${s.suggested_by} hat eine Idee für ${s.suggested_for}.`,
      url: "./#/wunschliste?tab=vorschlaege",
    };
  }
  return { error: "Unbekanntes Ereignis" };
}
