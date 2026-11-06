import { render } from "preact";
import { html, useState, useEffect, AppContext, useApp, visiblePages, Loading, Alert } from "./ui.js";
import { supabase, isConfigured } from "./supabase.js";
import { loadMyProfile, logout } from "./auth.js";
import { currentSeasonYear } from "./lib/season.js";
import { LoginPage } from "./pages/login.js";
import { DashboardPage } from "./pages/dashboard.js";
import { CountdownPage } from "./pages/countdown.js";
import { SettingsPage } from "./pages/settings.js";
import { WishlistPage } from "./pages/wishlist.js";
import { MealsPage } from "./pages/meals.js";
import { AttendancePage } from "./pages/attendance.js";
import { AdventPage } from "./pages/advent.js";

const ROUTES = {
  "": DashboardPage,
  countdown: CountdownPage,
  wunschliste: WishlistPage,
  essen: MealsPage,
  anwesenheit: AttendancePage,
  advent: AdventPage,
  einstellungen: SettingsPage,
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  return { route: path, params: Object.fromEntries(new URLSearchParams(query)) };
}

function useHashRoute() {
  const [loc, setLoc] = useState(parseHash());
  useEffect(() => {
    const onChange = () => { setLoc(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return loc;
}

function Toast({ text }) {
  return text ? html`<div class="toast" role="status">${text}</div>` : null;
}

function Layout({ route, children }) {
  const { me, settings, season } = useApp();
  const pages = visiblePages(settings);
  // Auf dem Handy: maximal 5 Einträge in der unteren Leiste
  const mobile = pages.filter((p) => p.key !== "countdown").slice(0, 5);
  return html`
    <div class="layout">
      <nav class="sidebar" aria-label="Hauptmenü">
        <div class="brand">🎄 Weihnachten ${season}</div>
        <div class="who">Angemeldet als <strong>${me.name}</strong></div>
        ${pages.map((p) => html`
          <a class=${`nav-link ${route === p.key ? "active" : ""}`} href=${`#/${p.key}`}>
            <span aria-hidden="true">${p.icon}</span>${p.label}
          </a>`)}
        <div class="bottom">
          <button class="nav-link" onClick=${() => logout()}><span aria-hidden="true">🚪</span>Abmelden</button>
        </div>
      </nav>
      <main class="main">${children}</main>
      <nav class="tabbar" aria-label="Hauptmenü">
        ${mobile.map((p) => html`
          <a class=${route === p.key ? "active" : ""} href=${`#/${p.key}`}>
            <span class="ico" aria-hidden="true">${p.icon}</span>${p.label.replace("Wer kommt wann?", "Wer kommt?").replace("Essensplanung", "Essen").replace("Adventskalender", "Advent").replace("Einstellungen", "Mehr")}
          </a>`)}
      </nav>
    </div>`;
}

function App() {
  const { route, params } = useHashRoute();
  const [session, setSession] = useState(undefined); // undefined = lädt noch
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [settings, setSettings] = useState({});
  const [toastText, setToastText] = useState("");
  const [fatal, setFatal] = useState("");
  const season = currentSeasonYear();

  const toast = (text) => {
    setToastText(text);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => setToastText(""), 2600);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadBasics = async () => {
    const [profile, all, sets] = await Promise.all([
      loadMyProfile(session.user.id),
      supabase.from("profiles").select("*").order("sort_order"),
      supabase.from("app_settings").select("*"),
    ]);
    if (!profile) {
      // Login existiert, ist aber keiner Person zugeordnet (z. B. PIN zurückgesetzt)
      await logout();
      return;
    }
    setMe(profile);
    setProfiles(all.data || []);
    setSettings(Object.fromEntries((sets.data || []).map((r) => [r.key, r.value])));
  };

  useEffect(() => {
    if (!session) { setMe(null); return; }
    loadBasics().catch((e) => setFatal(e.message));
  }, [session?.user?.id]);

  if (!isConfigured) {
    return html`<div class="login"><${Alert} kind="error">Die App ist noch nicht eingerichtet: Bitte in <code>web/config.js</code> die Supabase-Adresse und den publishable Key eintragen.<//></div>`;
  }
  if (session === undefined || (session && !me && !fatal)) return html`<${Loading} />`;
  if (fatal) return html`<div class="login"><${Alert} kind="error">${fatal}<//></div>`;
  if (!session) return html`<${LoginPage} /><${Toast} text=${toastText} />`;

  const value = {
    me, profiles, settings, season, toast, params,
    people: profiles.filter((p) => !p.is_family_account),
    profileByName: Object.fromEntries(profiles.map((p) => [p.name, p])),
    reloadSettings: loadBasics,
  };

  const allowed = visiblePages(settings).map((p) => p.key);
  const Page = allowed.includes(route) ? ROUTES[route] : DashboardPage;
  const activeRoute = allowed.includes(route) ? route : "";

  return html`
    <${AppContext.Provider} value=${value}>
      <${Layout} route=${activeRoute}>
        <${Page} params=${params} />
      <//>
      <${Toast} text=${toastText} />
    <//>`;
}

render(html`<${App} />`, document.getElementById("app"));

// Service Worker für Installation und Push-Nachrichten
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(console.error));
}
