import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_KEY, cleanItem, collectionValue, isDeal, load, sanitize, save, state } from "../js/store.js";

const good = { cardId: "base1-4", name: "Charizard", setId: "base1", setName: "Base Set", number: "4", image: "https://assets.tcgdex.net/en/base/base1/4", price: 954.65, currency: "USD", qty: 2, condition: "LP" };

test("cleanItem keeps valid fields", () => {
  const i = cleanItem(good);
  assert.equal(i.cardId, "base1-4");
  assert.equal(i.qty, 2);
  assert.equal(i.condition, "LP");
  assert.equal(i.image, good.image);
});

test("cleanItem rejects or neutralises hostile values", () => {
  assert.equal(cleanItem({ ...good, cardId: "../../etc" }), null);
  assert.equal(cleanItem({ ...good, cardId: "<img src=x>" }), null);
  assert.equal(cleanItem(null), null);
  const i = cleanItem({ ...good, image: "javascript:alert(1)", qty: 1e9, condition: "MINT", price: "12", currency: "BTC", name: "x".repeat(500), variant: "evil:<b>" });
  assert.equal(i.image, "");
  assert.equal(i.qty, 1);
  assert.equal(i.condition, "NM");
  assert.equal(i.price, null);
  assert.equal(i.currency, "USD");
  assert.equal(i.name.length, 80);
  assert.equal(i.variant, "");
  assert.equal(cleanItem({ ...good, image: "https://evil.example/x.png" }).image, "");
  assert.equal(cleanItem({ ...good, name: "a\u0000b\u001b" }).name, "ab");
});

test("sanitize rebuilds state and drops unknown keys and duplicate wishes", () => {
  const s = sanitize({ collection: [good, { cardId: "bad id" }], wishlist: [good, good], settings: { priceSource: "cardmarket", model: "gpt-4", __proto__: { x: 1 } }, extra: "nope", apiKey: "sk-ant-leak" });
  assert.equal(s.collection.length, 1);
  assert.equal(s.wishlist.length, 1);
  assert.equal(s.settings.priceSource, "cardmarket");
  assert.equal(s.settings.model, "claude-opus-5-5");
  assert.equal("extra" in s, false);
  assert.equal(JSON.stringify(s).includes("sk-ant"), false);
  assert.deepEqual(sanitize("junk").collection, []);
  assert.deepEqual(sanitize([1, 2]).collection, []);
});

test("collectionValue totals per currency", () => {
  const v = collectionValue([cleanItem(good), cleanItem({ ...good, cardId: "x-1", price: 2, currency: "EUR", qty: 3 }), cleanItem({ ...good, cardId: "y-1", price: null })]);
  assert.equal(v.totals.USD, 954.65 * 2);
  assert.equal(v.totals.EUR, 6);
  assert.equal(v.cards, 7);
  assert.equal(v.unique, 3);
});

test("isDeal compares price with target", () => {
  assert.equal(isDeal({ target: 10, price: 9.99 }), true);
  assert.equal(isDeal({ target: 10, price: 10 }), true);
  assert.equal(isDeal({ target: 10, price: 11 }), false);
  assert.equal(isDeal({ target: null, price: 1 }), false);
});

test("load/save round-trip through storage and survive corrupt data", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  state.collection = [cleanItem(good)];
  save(storage);
  state.collection = [];
  load(storage);
  assert.equal(state.collection.length, 1);
  mem.set(STORAGE_KEY, "{not json");
  load(storage);
  assert.equal(state.collection.length, 0);
});
