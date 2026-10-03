import type { Level } from "@/lib/pain";

export const LEVEL_STYLE: Record<Level, { bg: string; bar: string; label: string }> = {
  go: { bg: "bg-mint", bar: "text-emerald-500", label: "GO" },
  meh: { bg: "bg-butter", bar: "text-amber-500", label: "MEH" },
  wait: { bg: "bg-pink", bar: "text-rose-500", label: "WAIT" },
  unknown: { bg: "bg-lilac", bar: "text-violet-400", label: "???" },
};

/** Segmented bar, `value` 0..1. */
export function HpBar({ value, className = "", label }: { value: number; className?: string; label: string }) {
  const pct = Math.round(Math.max(0.04, Math.min(1, value)) * 100);
  return (
    <div className="hp" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={className} style={{ width: `${pct}%` }} />
    </div>
  );
}

// 6-step pastel scale, mint (breezy) → hot pink (suffering).
export const HEAT = ["#c8f5dd", "#e2f6c2", "#fff1b3", "#ffdcb0", "#ffc0cb", "#f79cba"];
