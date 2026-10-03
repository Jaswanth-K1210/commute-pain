import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPin, hashPin, signSession, verifySession } from "./crypto.ts";

test("pin hash round-trips and depends on pepper", () => {
  const h = hashPin("1234", "pep");
  assert.ok(checkPin("1234", h, "pep"));
  assert.ok(!checkPin("1235", h, "pep"));
  assert.ok(!checkPin("1234", h, "other"));
  assert.notEqual(hashPin("1234", "pep"), h); // salted
});

test("session tokens verify, reject tampering and expiry", () => {
  const s = { id: "0b4c-uuid", name: "jas_k" };
  const t = signSession(s, "secret", 60, 1_000_000);
  assert.deepEqual(verifySession(t, "secret", 1_000_000), s);
  assert.equal(verifySession(t, "wrong", 1_000_000), null);
  assert.equal(verifySession(t.replace("jas_k", "admin"), "secret", 1_000_000), null);
  assert.equal(verifySession(t, "secret", 1_000_000 + 61_000), null);
  assert.equal(verifySession(undefined, "secret"), null);
  assert.equal(verifySession("a.b.c", "secret"), null);
});
