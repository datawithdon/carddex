# Security

CardDex is a static site with no backend, accounts or cookies. This page lists
what it does to protect users and how to report a problem.

## Data and network

- **Your collection stays on your device.** It is stored in the browser's
  localStorage. Nothing is uploaded.
- **The page can only talk to three outside hosts.** Its Content-Security-Policy
  allows `api.tcgdex.net` (card data and prices), `assets.tcgdex.net` (card
  images) and `api.anthropic.com` (only if you use Claude vision). Everything
  else, including the OCR engine, is served from this site.
- **Photos stay on the device** unless you choose "Read with Claude". Then a
  downscaled JPEG goes to api.anthropic.com with your own API key.
- **Requests carry no referrer or credentials** (`no-referrer`, `credentials: omit`).

## Claude API key

- The key is kept in `sessionStorage`, which is cleared when the tab closes,
  unless you tick "Remember on this device" (then `localStorage`).
- It is sent only in the `x-api-key` header to api.anthropic.com. It is never
  written into backups or exports, and "Delete all data" removes it.
- Anyone with access to your browser profile can read a remembered key. Use a
  key with a spending limit, and don't tick Remember on shared devices.

## Hardening in the code

- No `innerHTML`, `eval` or inline scripts or styles. All text is rendered with
  `textContent`, and the CSP blocks inline code.
- Card data from the API, Claude's replies and imported backups are untrusted.
  Each record is rebuilt field by field with type, length and pattern checks
  (`js/store.js` `sanitize`, `js/api.js` `cleanCard`, `js/ai.js` `parseResponse`).
- Card IDs are validated before they are used in URL paths. Image URLs must be
  on `assets.tcgdex.net`.
- CSV exports neutralise spreadsheet formulas (cells starting with `= + - @`).
- Outbound links use `rel="noopener noreferrer"`.
- The app refuses to run inside a frame, because GitHub Pages can't send
  `X-Frame-Options` (clickjacking).
- Photos sent to Claude are re-encoded through a canvas, which strips EXIF
  metadata such as GPS location.
- Third-party code is vendored at pinned versions (see `vendor/tesseract/README.md`).

## Reporting

Please open a private security advisory on the GitHub repository rather than a
public issue.
