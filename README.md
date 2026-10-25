# CardDex: Pokémon card scanner

Point your phone at a Pokémon card. CardDex reads its name, HP and collector
number on the device, finds the exact printing, and shows its current TCGplayer
and Cardmarket prices. Save cards to a collection that adds up its value, tracks
how complete each set is, and alerts you when a wishlist card drops to your
target price.

**Live:** https://datawithdon.github.io/carddex/

It's a static web app: no backend, no account, and your data stays in your browser.

## Features

- **Scan** with the camera (a card-shaped guide shows where to hold it) or
  upload a photo. CardDex finds the card in the photo, rotates if needed, and
  runs OCR with [Tesseract.js](https://github.com/naptha/tesseract.js) on your
  device. A typical scan takes about one second after the first load.
- **Accurate matching.** The collector number (`025/198`) narrows the search to
  sets with that printed total. The name decides between them, and HP settles
  ties between same-number cards from different sets. Results say "Found it"
  only when the number and name agree and no other card comes close. Otherwise
  you get a best guess plus alternatives.
- **Claude vision (optional).** For foils, glare or odd angles, send the photo
  to Claude with your own API key. You can do this per scan, or automatically
  whenever OCR isn't sure.
- **Prices** per variant (holo, reverse holo, 1st edition…) from TCGdex, which
  collects TCGplayer (USD) and Cardmarket (EUR) data.
- **Collection:** quantity, condition, price paid and gain or loss, total value,
  filter and sort, CSV export, and JSON backup and restore.
- **Set completion:** progress per set, a full checklist with owned cards
  highlighted, "missing only", and one tap to wishlist every missing card.
- **Wishlist and price alerts:** set a target price. Prices are re-checked when
  you open the app (at most every 6 hours) or on demand. Cards at or below
  target are flagged, with optional browser notifications.
- **Manual search** by name, set, type and rarity.
- **Installable** as a PWA, works on phones, and supports light and dark mode.

## Run locally

```sh
npm start          # serves on http://127.0.0.1:8000
npm test           # unit tests (Node 20+)
```

The camera needs HTTPS or `localhost`. Uploading photos works anywhere.

## How it works

```
photo ─► autoCrop ─► OCR strips (name · HP · number) ─► parse ─► TCGdex lookup ─► rank
                                                        │                │
                                         "006/165" ─► sets with 165 ─► /sets/{id}/006
                                         "Charizard" ─► name search (fallback)
```

| File | Purpose |
|---|---|
| `js/ocr.js` | Card detection, crops and contrast, Tesseract worker (all served locally) |
| `js/match.js` | Pure logic: number, HP and name parsing, fuzzy scoring, price picking, CSV |
| `js/identify.js` | Read → candidate cards → ranked matches |
| `js/api.js` | TCGdex client with timeouts, caching and response cleaning |
| `js/ai.js` | Claude vision request (structured JSON output) and reply validation |
| `js/store.js` | State, localStorage persistence, strict sanitising of stored or imported data |
| `js/prices.js` | Price refresh and wishlist alerts |
| `js/views/*` | Scan, Search, Collection, Sets, Wishlist, Settings |

## Privacy and security

See [SECURITY.md](SECURITY.md). In short: a strict Content-Security-Policy, no
inline code, every external response validated, and the API key kept in session
storage by default and never included in backups.

## Credits

Card data, images and prices: [TCGdex](https://tcgdex.dev). OCR:
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0).

CardDex is an unofficial fan project and is not affiliated with Nintendo, The
Pokémon Company, Creatures or Game Freak. Pokémon and card images are
trademarks of their respective owners. Prices are guides, not offers.

## License

MIT, see [LICENSE](LICENSE). Vendored OCR files are Apache-2.0.
