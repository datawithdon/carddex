// On-device OCR with Tesseract.js. The library, its WebAssembly core and the
// English model are all served from vendor/ on this site — no CDN — so the
// photo never leaves the device. Only small strips of the card are read: the
// title strip (name, HP) and the bottom edge (collector number such as 025/198).

import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { parseNumbers } from "./match.js";

const VENDOR = new URL("../vendor/tesseract/", import.meta.url).href;
const MAX_SIDE = 1400;

let workerPromise = null;

function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${VENDOR}worker.min.js`,
      corePath: `${VENDOR}core/`,
      langPath: `${VENDOR}lang/`,
      workerBlobURL: false,
      gzip: true,
      logger: (m) => {
        if (m && typeof m.progress === "number" && typeof m.status === "string") onProgressRef.fn(m);
      },
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  onProgressRef.fn = onProgress || (() => {});
  return workerPromise;
}
const onProgressRef = { fn: () => {} };

/** Draw an image/bitmap to a canvas no larger than MAX_SIDE. */
export function toCanvas(source, crop = null) {
  const sw = crop ? crop.w : source.width ?? source.videoWidth;
  const sh = crop ? crop.h : source.height ?? source.videoHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext("2d").drawImage(source, crop ? crop.x : 0, crop ? crop.y : 0, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Find the card in a photo with background around it and crop to it.
 * Works on edge density: the card's printing is busy, a table or hand mostly
 * isn't. Returns the input unchanged when no card-shaped region stands out.
 */
export function autoCrop(src) {
  const scale = Math.min(1, 240 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const rows = new Float32Array(h), cols = new Float32Array(w);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]) > 48) { rows[y]++; cols[x]++; }
    }
  }
  const ys = longestRun(rows, w * 0.12), xs = longestRun(cols, h * 0.12);
  if (!ys || !xs) return src;
  const bw = xs[1] - xs[0], bh = ys[1] - ys[0];
  const ratio = bw / bh, area = (bw * bh) / (w * h);
  // Already filling the frame, or not card-shaped: leave it alone.
  if (area > 0.85 || area < 0.12 || ratio < 0.55 || ratio > 0.9) return src;
  const pad = 0.004;
  const x0 = Math.max(0, xs[0] / w - pad), y0 = Math.max(0, ys[0] / h - pad);
  const x1 = Math.min(1, xs[1] / w + pad), y1 = Math.min(1, ys[1] / h + pad);
  return toCanvas(src, { x: x0 * src.width, y: y0 * src.height, w: (x1 - x0) * src.width, h: (y1 - y0) * src.height });
}

/** Longest stretch of indices whose value exceeds `min`, bridging gaps of up to 4%. */
function longestRun(arr, min) {
  const gap = Math.max(2, Math.round(arr.length * 0.04));
  let best = null, start = -1, last = -1;
  for (let i = 0; i <= arr.length; i++) {
    const on = i < arr.length && arr[i] > min;
    if (on) { if (start < 0) start = i; last = i; continue; }
    if (start >= 0 && (i - last > gap || i === arr.length)) {
      if (!best || last - start > best[1] - best[0]) best = [start, last + 1];
      start = -1;
    }
  }
  return best;
}

/** Cut a region (fractions of width/height), upscale and convert to high-contrast greyscale. */
function strip(card, fx, fy, fw, fh, upscale = 2) {
  const sx = Math.round(card.width * fx), sy = Math.round(card.height * fy);
  const sw = Math.round(card.width * fw), sh = Math.round(card.height * fh);
  const c = document.createElement("canvas");
  c.width = sw * upscale;
  c.height = sh * upscale;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(card, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - lo) / span) * 255;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Read a card canvas (card filling the frame, upright).
 * Returns { nameText, hpText, numberText }.
 */
export async function readCard(card, onProgress) {
  const worker = await getWorker(onProgress);
  // Title strip: the name sits ~3–12% down, left of the HP. PSM 6 = one block of text.
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const nameRes = await worker.recognize(strip(card, 0.08, 0.03, 0.62, 0.09));
  // HP corner (top right), used to tell same-number cards apart. PSM 11 = sparse text.
  await worker.setParameters({ tessedit_pageseg_mode: "11" });
  const hpRes = await worker.recognize(strip(card, 0.6, 0.03, 0.38, 0.07));
  // Collector number: bottom strip, full width (left on modern cards, right on vintage).
  await worker.setParameters({ tessedit_char_whitelist: "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz " });
  let numberText = (await worker.recognize(strip(card, 0, 0.86, 1, 0.13, 3))).data.text || "";
  if (!parseNumbers(numberText).length) {
    // Fall back to each half on its own: less clutter for the recogniser.
    for (const fx of [0, 0.5]) numberText += `\n${(await worker.recognize(strip(card, fx, 0.88, 0.5, 0.11, 3))).data.text || ""}`;
  }
  return { nameText: nameRes.data.text || "", hpText: hpRes.data.text || "", numberText };
}

export async function warmUp(onProgress) {
  await getWorker(onProgress);
}
