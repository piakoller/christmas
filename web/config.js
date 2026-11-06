// Öffentliche Einstellungen der App. Diese Werte dürfen im Repository stehen:
// Der "publishable" Key erlaubt nur, was die Datenbank-Regeln (RLS) zulassen.
// NIE den "secret"/"service_role" Key hier eintragen!
export const CONFIG = {
  supabaseUrl: "https://joumnlamyswwgwziywba.supabase.co",
  supabaseKey: "sb_publishable_ZEsTR-OseZZTMa_KIrw5Zw_hzJLNNZP",
  // Öffentlicher VAPID-Schlüssel für Push-Nachrichten (siehe README)
  vapidPublicKey: "BLFWSqC1ExsH_Vdx5MYyGvnIl7a3FwWQaUEPmgT0u9OLQV6m4PMlzhM4oL346LqzCOXeklUfkb0hq4Jjrp9D5Jk",
  // Kunst-Adresse für die Logins (wird nie angeschrieben)
  authEmailDomain: "weihnachten.example.com",
  budgetLimit: 1500,
};
