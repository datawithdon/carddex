// Settings: price source, Claude vision key/model, scanning and alert options, backup/restore, wipe.

import { download, h, mount, toast } from "../dom.js";
import { MODELS, STORAGE_KEY, getApiKey, keyRemembered, replaceAll, save, setApiKey, state } from "../store.js";

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export function render(root) {
  const s = state.settings;

  const source = h("select", { id: "src" },
    h("option", { value: "tcgplayer", selected: s.priceSource === "tcgplayer" }, "TCGplayer market (USD)"),
    h("option", { value: "cardmarket", selected: s.priceSource === "cardmarket" }, "Cardmarket trend (EUR)"));
  source.addEventListener("change", () => { s.priceSource = source.value; save(); toast("Saved. Refresh prices to apply it to existing cards."); });

  const key = h("input", { id: "key", type: "password", autocomplete: "off", spellcheck: "false", placeholder: getApiKey() ? "•••••••• (saved)" : "sk-ant-…" });
  const remember = h("input", { type: "checkbox", id: "remember", checked: keyRemembered() });
  const model = h("select", { id: "model" }, Object.entries(MODELS).map(([id, label]) => h("option", { value: id, selected: s.model === id }, label)));
  model.addEventListener("change", () => { s.model = model.value; save(); });
  const saveKey = () => {
    const v = key.value.trim();
    if (v && !/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(v)) { toast("That doesn't look like a Claude API key."); return; }
    setApiKey(v || getApiKey(), remember.checked);
    key.value = "";
    key.placeholder = getApiKey() ? "•••••••• (saved)" : "sk-ant-…";
    toast(getApiKey() ? "Key saved" : "No key set");
  };
  const forget = () => { setApiKey("", false); remember.checked = false; key.placeholder = "sk-ant-…"; toast("Key removed"); };

  const toggle = (id, label, prop, onOn) => {
    const box = h("input", { type: "checkbox", id, checked: s[prop] });
    box.addEventListener("change", async () => {
      s[prop] = box.checked;
      if (box.checked && onOn && !(await onOn())) { s[prop] = false; box.checked = false; }
      save();
    });
    return h("label", { class: "check", for: id }, box, " ", label);
  };

  const askNotify = async () => {
    if (typeof Notification === "undefined") { toast("This browser doesn't support notifications."); return false; }
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (p !== "granted") toast("Notifications are blocked for this site.");
    return p === "granted";
  };

  const file = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", id: "restore" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) { toast("Backup file is too large."); return; }
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast("That file isn't valid JSON."); return; }
    if (!data || typeof data !== "object" || !Array.isArray(data.collection)) { toast("That isn't a CardDex backup."); return; }
    if (!confirm(`Replace your current data with this backup (${data.collection.length} collection rows)?`)) return;
    replaceAll(data);
    toast(`Restored ${state.collection.length} cards and ${state.wishlist.length} wishlist items`);
    render(root);
  });

  const backup = () => download(`carddex-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "carddex", ...state }, null, 1), "application/json");

  const wipe = () => {
    if (!confirm("Delete your whole collection, wishlist, settings and saved API key from this browser? This can't be undone.")) return;
    setApiKey("", false);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("carddex.sets"); } catch { /* ignore */ }
    replaceAll(null);
    toast("All CardDex data deleted from this browser");
    render(root);
  };

  mount(root, h("section", { class: "panel narrow" },
    h("h1", {}, "Settings"),
    h("h2", {}, "Prices"),
    h("label", { for: "src" }, "Price source"), source,
    h("p", { class: "muted small" }, "Prices come from TCGdex, which collects TCGplayer and Cardmarket data. They are guides, not offers."),

    h("h2", {}, "Claude vision (optional)"),
    h("p", { class: "muted small" }, "For foils, glare or odd angles, CardDex can send the photo to Claude with your own API key. The key stays in this browser (cleared when the tab closes, unless you tick Remember) and is only ever sent to api.anthropic.com. Each scan costs a fraction of a cent."),
    h("label", { for: "key" }, "API key"), key,
    h("label", { class: "check", for: "remember" }, remember, " Remember on this device"),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: saveKey }, "Save key"), h("button", { class: "btn", type: "button", onclick: forget }, "Remove key")),
    h("label", { for: "model" }, "Model"), model,
    toggle("autoai", "Use Claude automatically when on-device OCR isn't sure", "autoAi"),

    h("h2", {}, "Scanning & alerts"),
    toggle("keepcam", "Keep the camera open after adding a card (bulk scanning)", "keepCamera"),
    toggle("notify", "Notify me when a wishlist card hits its target price", "notify", askNotify),

    h("h2", {}, "Your data"),
    h("p", { class: "muted small" }, "Everything is stored only in this browser. Back it up to move it to another device. Backups never include your API key."),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: backup }, "Download backup"),
      h("label", { class: "btn", for: "restore" }, "Restore backup"), file,
      h("button", { class: "btn danger", type: "button", onclick: wipe }, "Delete all data"))));
}
