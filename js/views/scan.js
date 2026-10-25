// Scan: camera (with a card-shaped guide) or photo upload → OCR → TCGdex matches.
// Claude vision is offered as a second reader when OCR can't find the card.

import { readWithClaude } from "../ai.js";
import { h, mount } from "../dom.js";
import { identify } from "../identify.js";
import { nameTokens, sameNumber } from "../match.js";
import { autoCrop, readCard, toCanvas, warmUp } from "../ocr.js";
import { getApiKey, ownedIds, state } from "../store.js";
import { cardSheet, cardTile } from "../ui.js";

const CARD_RATIO = 63 / 88;
let stream = null;
let lastCanvas = null;

export function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
}

export function render(root) {
  const video = h("video", { playsinline: true, muted: true, autoplay: true, "aria-label": "Camera preview" });
  const guide = h("div", { class: "guide", "aria-hidden": "true" });
  const stage = h("div", { class: "camera hidden" }, video, guide);
  const status = h("div", { class: "status", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "results" });
  const preview = h("div", { class: "preview" });
  const file = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", id: "scan-file" });

  const camBtn = h("button", { class: "btn primary", type: "button" }, "Start camera");
  const shotBtn = h("button", { class: "btn primary hidden", type: "button" }, "Capture card");
  const stopBtn = h("button", { class: "btn hidden", type: "button" }, "Stop camera");

  const say = (msg, kind = "") => { status.className = `status ${kind}`; status.textContent = msg; };

  function layoutGuide() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const g = guideRect(vw, vh);
    stage.style.aspectRatio = `${vw} / ${vh}`;
    Object.assign(guide.style, { left: `${(g.x / vw) * 100}%`, top: `${(g.y / vh) * 100}%`, width: `${(g.w / vw) * 100}%`, height: `${(g.h / vh) * 100}%` });
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { say("This browser can't open the camera. Upload a photo instead.", "error"); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      say(e && e.name === "NotAllowedError" ? "Camera permission was denied. You can upload a photo instead." : "Couldn't open the camera. Upload a photo instead.", "error");
      return;
    }
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", layoutGuide, { once: true });
    stage.classList.remove("hidden");
    camBtn.classList.add("hidden");
    shotBtn.classList.remove("hidden");
    stopBtn.classList.remove("hidden");
    say("Fill the frame with the card, upright, without glare. Then capture.");
    warmUp().catch(() => {});
  }

  function stop() {
    stopCamera();
    video.srcObject = null;
    stage.classList.add("hidden");
    camBtn.classList.remove("hidden");
    shotBtn.classList.add("hidden");
    stopBtn.classList.add("hidden");
  }

  async function capture() {
    if (!video.videoWidth) return;
    const g = guideRect(video.videoWidth, video.videoHeight);
    await scan(autoCrop(toCanvas(video, g)));
  }

  async function onFile() {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type) || f.size > 25 * 1024 * 1024) { say("Choose an image file under 25 MB.", "error"); return; }
    let bmp;
    try { bmp = await createImageBitmap(f, { imageOrientation: "from-image" }); } catch { say("That image couldn't be opened.", "error"); return; }
    const c = autoCrop(toCanvas(bmp));
    bmp.close?.();
    await scan(c);
  }

  async function scan(canvas, { reader = "ocr" } = {}) {
    lastCanvas = canvas;
    mount(preview, h("img", { src: canvas.toDataURL("image/jpeg", 0.8), alt: "Captured card", class: "shot" }),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => scan(rotate(lastCanvas)) }, "Rotate ↻"),
        getApiKey() && reader === "ocr" ? h("button", { class: "btn small", type: "button", onclick: () => scan(lastCanvas, { reader: "ai" }) }, "Read with Claude") : null));
    results.replaceChildren();
    let read;
    try {
      if (reader === "ai") {
        say("Asking Claude to read the card…");
        read = await readWithClaude(canvas, state.settings.model);
      } else {
        say("Reading card text on this device…");
        read = await readCard(canvas, (m) => {
          if (m.status === "loading language traineddata" || m.status === "loading tesseract core") say(`Loading OCR engine (first time only)… ${Math.round(m.progress * 100)}%`);
        });
      }
    } catch (e) {
      say(e.message || "Couldn't read the card.", "error");
      return;
    }
    let out;
    try {
      out = await identify(read, (msg) => say(msg));
    } catch (e) {
      say(e.message, "error");
      return;
    }
    if (!isSure(out) && reader === "ocr" && state.settings.autoAi && getApiKey()) {
      say("OCR wasn't sure. Trying Claude…");
      return scan(canvas, { reader: "ai" });
    }
    showResults(out, reader);
  }

  function showResults({ read, matches }, reader) {
    const owned = ownedIds();
    const readLine = h("p", { class: "muted small" }, `Read${reader === "ai" ? " by Claude" : ""}: `,
      h("code", {}, (read.nameText || "—").replace(/\s+/g, " ").slice(0, 60)), " · number ",
      h("code", {}, read.number ? `${read.number}${read.total ? `/${read.total}` : ""}` : "not found"),
      read.hp?.length ? [" · HP ", h("code", {}, read.hp.join("/"))] : null);
    const guess = nameTokens(read.nameText)[0] || "";
    const actions = h("div", { class: "row" },
      reader === "ocr" && getApiKey() ? h("button", { class: "btn", type: "button", onclick: () => scan(lastCanvas, { reader: "ai" }) }, "Not right? Read with Claude") : null,
      reader === "ocr" && !getApiKey() ? h("a", { class: "btn", href: "#/settings" }, "Add a Claude key for hard scans") : null,
      h("a", { class: "btn", href: `#/search?q=${encodeURIComponent(guess)}` }, "Search manually"));

    if (!matches.length) {
      say("No matching card found. Try better light, hold the card flat, or search manually.", "error");
      mount(results, readLine, actions);
      return;
    }
    const sure = isSure({ read, matches });
    say(sure ? "Found it." : "Best guess below. Check it's the right card, or pick another.", sure ? "ok" : "");
    const best = matches[0];
    mount(results, readLine,
      h("div", { class: "best" }, cardSheet(best, afterAdd)),
      matches.length > 1 ? [h("h3", {}, "Other possibilities"), h("div", { class: "grid" }, matches.slice(1).map((c) => cardTile(c, { owned: owned.has(c.id), score: c.score })))] : null,
      actions);
  }

  function afterAdd(what) {
    if (what === "added" && stream && state.settings.keepCamera) {
      results.replaceChildren();
      preview.replaceChildren();
      say("Added. Ready for the next card.", "ok");
      shotBtn.focus();
    }
  }

  camBtn.addEventListener("click", startCamera);
  shotBtn.addEventListener("click", capture);
  stopBtn.addEventListener("click", stop);
  file.addEventListener("change", onFile);
  addEventListener("resize", layoutGuide);

  mount(root,
    h("section", { class: "panel" },
      h("h1", {}, "Scan a card"),
      h("p", { class: "muted" }, "Point your camera at a card, or upload a photo. Text is read on this device; nothing is uploaded unless you choose Claude."),
      h("div", { class: "row" }, camBtn, shotBtn, stopBtn, h("label", { class: "btn", for: "scan-file" }, "Upload photo"), file),
      stage, status, preview, results));
}

/**
 * Only claim a match when the number agrees as well as the name, and no other
 * card (e.g. a same-numbered card from another set) is nearly as good.
 */
function isSure({ read, matches }) {
  const top = matches[0];
  if (!top || top.score < 0.75 || !read.number || !sameNumber(top.localId, read.number)) return false;
  return !matches[1] || top.raw - matches[1].raw >= 0.08;
}

/** Card-shaped region centred in the frame: 85% of the height, capped at 90% of the width. */
export function guideRect(vw, vh) {
  let gh = vh * 0.85, gw = gh * CARD_RATIO;
  if (gw > vw * 0.9) { gw = vw * 0.9; gh = gw / CARD_RATIO; }
  return { x: Math.round((vw - gw) / 2), y: Math.round((vh - gh) / 2), w: Math.round(gw), h: Math.round(gh) };
}

function rotate(src) {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext("2d");
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}
