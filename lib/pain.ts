// Pure commute math. No I/O here so it can be tested with `npm test`.

export type Slot = { dow: number; slot: number; median_min: number; n: number }; // dow 0=Mon, slot 0..47 (IST half-hours)
export type Level = "go" | "meh" | "wait" | "unknown";

export const MIN_SAMPLES = 3;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function slotLabel(slot: number) {
  const h = Math.floor(slot / 2), m = slot % 2 ? "30" : "";
  return `${h % 12 || 12}${m ? ":" + m : ""}${h < 12 ? "am" : "pm"}`;
}

/** Current IST weekday/slot. IST has no DST, so a fixed +5:30 is exact. */
export function istNow(d = new Date()) {
  const t = new Date(d.getTime() + 330 * 60_000);
  const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
  return { dow: (t.getUTCDay() + 6) % 7, slot: Math.floor(minute / 30), minute };
}

export const ready = (slots: Slot[]) => slots.filter((s) => s.n >= MIN_SAMPLES);

// Best/worst only count slots someone would actually commute in (7am–10:30pm); 3am is always "best" and useless.
const COMMUTE = (s: Slot) => s.slot >= 14 && s.slot <= 45;

const byMedian = (a: Slot, b: Slot) => a.median_min - b.median_min;

/** Worst and best slot of the week (only slots with enough samples). */
export function extremes(slots: Slot[]) {
  const r = ready(slots).filter(COMMUTE).sort(byMedian);
  if (r.length < 2) return null;
  const best = r[0], worst = r[r.length - 1];
  return { best, worst, ratio: worst.median_min / best.median_min };
}

/** "Friday 6:30pm is 2.4x worse than 2pm" — compares to the best slot on the same day when possible. */
export function brag(slots: Slot[]) {
  const x = extremes(slots);
  if (!x) return null;
  const sameDay = ready(slots).filter((s) => COMMUTE(s) && s.dow === x.worst.dow && s !== x.worst).sort(byMedian)[0];
  const best = sameDay ?? x.best;
  const ratio = x.worst.median_min / best.median_min;
  const bestTxt = best.dow === x.worst.dow ? slotLabel(best.slot) : `${DAYS[best.dow]} ${slotLabel(best.slot)}`;
  return `${DAYS[x.worst.dow]} ${slotLabel(x.worst.slot)} is ${ratio.toFixed(1)}x worse than ${bestTxt}`;
}

/** Compare the live duration against this weekday+slot's typical, and find a better slot later today. */
export function verdict(currentMin: number | null, slots: Slot[], now = istNow()) {
  const today = ready(slots).filter((s) => s.dow === now.dow);
  const typical = today.find((s) => s.slot === now.slot)?.median_min ?? null;
  const ratio = currentMin != null && typical ? currentMin / typical : null;
  const level: Level = ratio == null ? "unknown" : ratio <= 1.1 ? "go" : ratio <= 1.3 ? "meh" : "wait";

  // Next best departure: earliest later slot within 10% of today's remaining minimum,
  // and only if it actually beats leaving now.
  const later = today.filter((s) => s.slot > now.slot).sort((a, b) => a.slot - b.slot);
  let next: Slot | null = null;
  if (later.length) {
    const floor = Math.min(...later.map((s) => s.median_min));
    const cand = later.find((s) => s.median_min <= floor * 1.1)!;
    const nowCost = currentMin ?? typical ?? Infinity;
    if (cand.median_min < nowCost * 0.9) next = cand;
  }
  const waitMin = next ? next.slot * 30 - now.minute : null;
  return { level, ratio, typical, next, waitMin };
}

const COPY: Record<Level, string[]> = {
  go: [
    "roads are weirdly empty. suspicious. go.",
    "green light, literally. leave before your manager finds you.",
    "the traffic gods are napping. sneak out.",
    "even the autos are behaving. GO GO GO.",
  ],
  meh: [
    "it's… fine. bring a podcast.",
    "mid traffic. mid life. just go?",
    "could be worse. could be the ORR.",
    "bearable if you have snacks.",
  ],
  wait: [
    "the ORR is a parking lot rn.",
    "Biodiversity flyover said no.",
    "stay. answer one more email. look productive.",
    "you'd walk faster. you won't, but you could.",
  ],
  unknown: [
    "collecting data… the logger is out there sniffing exhaust.",
    "not enough samples yet. vibes only.",
  ],
};

/** Deterministic quip so server and client never disagree. */
export const quip = (level: Level, seed: number) => COPY[level][seed % COPY[level].length];
