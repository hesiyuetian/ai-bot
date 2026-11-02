import assert from "node:assert/strict";
import { test } from "node:test";
import { splitList } from "../../src/tools/list.ts";

test("splits comma-separated recipients", () => {
  assert.deepEqual(splitList("121321,4345345,2342"), ["121321", "4345345", "2342"]);
});

test("trims spaces, accepts Chinese commas, drops empties and duplicates", () => {
  assert.deepEqual(splitList(" a@x.com , b@y.com，,a@x.com "), ["a@x.com", "b@y.com"]);
});

test("returns an empty list when unset", () => {
  assert.deepEqual(splitList(undefined), []);
  assert.deepEqual(splitList(""), []);
});
