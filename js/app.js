// Entry point: hash router, nav state, modal keyboard handling, service worker.

import { $, $$ } from "./dom.js";
import { autoCheck } from "./prices.js";
import { isDeal, load, onChange, state } from "./store.js";
import { closeModal } from "./ui.js";
import * as collection from "./views/collection.js";
import * as scan from "./views/scan.js";
import * as search from "./views/search.js";
import * as sets from "./views/sets.js";
import * as settings from "./views/settings.js";
import * as wishlist from "./views/wishlist.js";

const ROUTES = { scan, search, collection, sets, wishlist, settings };

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [name, arg] = path.split("/");
  const view = Object.hasOwn(ROUTES, name) ? name : "scan";
  if (view !== "scan") scan.stopCamera();
  closeModal();
  for (const a of $$("nav a")) a.toggleAttribute("aria-current", a.dataset.view === view);
  const root = $("#view");
  let id = "";
  try { id = arg ? decodeURIComponent(arg) : ""; } catch { id = ""; }
  ROUTES[view].render(root, new URLSearchParams(query), id);
  root.focus({ preventScroll: true });
}

function updateBadges() {
  const deals = state.wishlist.filter(isDeal).length;
  const b = $("#nav-deals");
  b.textContent = deals ? String(deals) : "";
  b.classList.toggle("hidden", !deals);
  $("#nav-count").textContent = state.collection.length ? String(state.collection.reduce((n, i) => n + i.qty, 0)) : "";
}

// GitHub Pages can't send X-Frame-Options and a <meta> CSP can't set
// frame-ancestors, so refuse to run inside another site's frame (clickjacking).
if (window.top !== window.self) {
  document.body.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "CardDex can't run inside another site. Open it directly." }));
  throw new Error("framed");
}

load();
onChange(updateBadges);
updateBadges();
addEventListener("hashchange", route);
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
addEventListener("pagehide", () => scan.stopCamera());
route();

autoCheck().then((r) => { if (r) updateBadges(); });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
