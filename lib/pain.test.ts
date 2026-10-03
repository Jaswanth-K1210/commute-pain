import { test } from "node:test";
import assert from "node:assert/strict";
import { brag, extremes, istNow, slotLabel, slugify, verdict, type Slot } from "./pain.ts";

const s = (dow: number, slot: number, median_min: number, n = 5): Slot => ({ dow, slot, median_min, n });

test("labels, slugs, IST clock", () => {
  assert.equal(slotLabel(0), "12am");
  assert.equal(slotLabel(37), "6:30pm");
  assert.equal(slotLabel(28), "2pm");
  assert.equal(slugify("Gachibowli→Ameerpet"), "gachibowli-ameerpet");
  // 2026-10-02 13:00 UTC = Friday 18:30 IST
  assert.deepEqual(istNow(new Date("2026-10-02T13:00:00Z")), { dow: 4, slot: 37, minute: 1110 });
  // 2026-10-04 19:00 UTC = Monday 00:30 IST (day rollover)
  assert.equal(istNow(new Date("2026-10-04T19:00:00Z")).dow, 0);
});

test("extremes ignore thin slots and brag compares same day", () => {
  const slots = [s(4, 37, 60), s(4, 28, 25), s(2, 20, 20), s(4, 40, 999, 2), s(4, 6, 10)]; // 3am ignored
  const x = extremes(slots)!;
  assert.equal(x.worst.slot, 37);
  assert.equal(x.best.dow, 2);
  assert.equal(brag(slots), "Friday 6:30pm is 2.4x worse than 2pm");
  assert.equal(extremes([s(0, 1, 10)]), null);
});

test("verdict levels and next best slot", () => {
  const now = { dow: 4, slot: 37, minute: 37 * 30 + 10 };
  const slots = [s(4, 37, 40), s(4, 38, 45), s(4, 39, 30), s(4, 40, 24), s(4, 41, 25)];
  const v = verdict(60, slots, now);
  assert.equal(v.level, "wait");
  assert.equal(v.next?.slot, 40); // 24 is the floor; 41 (25) is within 10% but later
  assert.equal(v.waitMin, 80);
  assert.equal(verdict(42, slots, now).level, "go");
  assert.equal(verdict(50, slots, now).level, "meh");
  assert.equal(verdict(null, slots, now).level, "unknown");
  assert.equal(verdict(20, slots, now).next, null); // nothing later beats leaving now
});
