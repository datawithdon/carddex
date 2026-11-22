// Trusted Types. The page's CSP (require-trusted-types-for 'script') makes the
// browser refuse plain strings at script-loading sinks such as new Worker(),
// serviceWorker.register() and <script>.src. This "default" policy is the only
// one the CSP allows, and it accepts exactly the script files listed below,
// resolved against this app's own folder. Anything else throws.
// Must be the first import in app.js so it exists before any sink runs.

const ROOT = new URL("../", import.meta.url);
const ALLOWED = new Set(["sw.js", "vendor/tesseract/worker.min.js"].map((p) => new URL(p, ROOT).href));

if (globalThis.trustedTypes && !globalThis.trustedTypes.defaultPolicy) {
  globalThis.trustedTypes.createPolicy("default", {
    createScriptURL(value) {
      const url = new URL(String(value), document.baseURI);
      if (url.origin === location.origin && !url.search && !url.hash && ALLOWED.has(url.href)) return String(value);
      throw new TypeError(`Blocked script URL: ${String(value).slice(0, 80)}`);
    },
  });
}
