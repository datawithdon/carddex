import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest, parseResponse } from "../js/ai.js";

const img = { mediaType: "image/jpeg", base64: "AAAA" };
const reply = (obj, extra = {}) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }], ...extra });

test("buildRequest uses structured output, effort and fallbacks", () => {
  const { body, betas } = buildRequest(img, "claude-opus-5-5");
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.messages[0].content[0].type, "image");
  assert.equal("temperature" in body, false);
});

test("buildRequest skips fallbacks on Haiku and rejects unknown models", () => {
  const h = buildRequest(img, "claude-haiku-5-5");
  assert.equal(h.body.fallbacks, undefined);
  assert.deepEqual(h.betas, []);
  assert.equal(buildRequest(img, "gpt-5").body.model, "claude-opus-5-5");
});

test("parseResponse validates and cleans the model's JSON", () => {
  const r = parseResponse(reply({ isPokemonCard: true, name: " Charizard ex\u0000 ", number: "006", printedTotal: "165", setName: "151" }));
  assert.deepEqual(r, { nameText: "Charizard ex", numberText: "006/165", setName: "151" });
  const n = parseResponse(reply({ isPokemonCard: true, name: "Mew", number: "<script>", printedTotal: "", setName: "" }));
  assert.equal(n.numberText, "");
});

test("parseResponse surfaces refusals, truncation and non-cards", () => {
  assert.throws(() => parseResponse({ stop_reason: "refusal", content: [] }), /declined/);
  assert.throws(() => parseResponse({ stop_reason: "max_tokens", content: [] }), /cut off/);
  assert.throws(() => parseResponse(reply({ isPokemonCard: false, name: "", number: "", printedTotal: "", setName: "" })), /isn't a Pokémon card|doesn't think/);
  assert.throws(() => parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] }), /valid JSON/);
  assert.throws(() => parseResponse(null), /Empty/);
});
