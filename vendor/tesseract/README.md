# Vendored OCR

Served from this site so scans never touch a CDN.

| File | Source | Version | License |
|---|---|---|---|
| `tesseract.esm.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) `dist/` | 7.0.0 | Apache-2.0 |
| `core/tesseract-core-*lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 |
| `lang/eng.traineddata.gz` | [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) `4.0.0_best_int` | 4.0.0 | Apache-2.0 |

Only the LSTM cores are included (the app runs Tesseract in LSTM-only mode); the
worker picks the relaxed-SIMD, SIMD or plain build for the device. Source-map
comments were removed; the code is otherwise unmodified.

To update: `npm i tesseract.js tesseract.js-core @tesseract.js-data/eng` in a
scratch folder, copy the same files over, and bump `CACHE` in `sw.js`.
