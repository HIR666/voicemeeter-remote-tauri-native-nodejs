const test = require("node:test");
const assert = require("node:assert/strict");
const { boolean01, validCommand } = require("../lib/protocol.cjs");

test("normalizes Voicemeeter boolean values", () => {
  assert.equal(boolean01(0), 0);
  assert.equal(boolean01("1"), 1);
  assert.equal(boolean01(0.5), 0);
});

test("rejects malformed or out-of-range commands", () => {
  assert.equal(validCommand({ type: "setStripParam", payload: { stripIndex: 7, param: "Gain", value: 4 } }), true);
  assert.equal(validCommand({ type: "setStripParam", payload: { stripIndex: 8, param: "Gain", value: 4 } }), false);
  assert.equal(validCommand({ type: "setBusParam", payload: { busIndex: 0, param: "A1", value: 1 } }), false);
  assert.equal(validCommand({ type: "exec", payload: {} }), false);
});
