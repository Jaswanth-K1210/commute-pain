import Link from "next/link";
import type { Metadata } from "next";
import { getRoutes, getSlots } from "@/lib/db";
import { DAYS, extremes, slotLabel } from "@/lib/pain";
import { HpBar } from "../ui";

export const metadata: Metadata = { title: "Pain Leaderboard · Commute Pain" };

const MEDALS = ["👑", "🥈", "🥉"];

export default async function Leaderboard() {
  const rows = await Promise.all((await getRoutes()).map(async (r) => ({ route: r, x: extremes(await getSlots(r.id)) })));
  rows.sort((a, b) => (b.x?.ratio ?? 0) - (a.x?.ratio ?? 0));
  const top = rows[0]?.x?.ratio ?? 1;

  return (
    <>
      <h1 className="font-pixel text-xl leading-snug sm:text-3xl">BOSS LEADERBOARD</h1>
      <p className="mt-2 mb-6 text-mute">every player&apos;s commute, ranked by peak ÷ off-peak median. higher = more emotional damage. 👑 = most cursed.</p>
      <ol className="space-y-4">
        {rows.map(({ route, x }, i) => (
          <li key={route.id}>
            <Link href={`/route/${route.slug}`} className="card press flex items-center gap-4 p-4">
              <span className="font-pixel w-8 shrink-0 text-center text-sm">{x ? MEDALS[i] ?? i + 1 : "?"}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-pixel truncate text-[10px] sm:text-xs">{route.name}</h2>
                    <p className="font-pixel mt-1 text-[8px] text-mute">{route.owner ? `@${route.owner.name}` : "community"}</p>
                  </div>
                  <span className="text-3xl leading-none">{x ? `${x.ratio.toFixed(1)}x` : "…"}</span>
                </div>
                <HpBar label="boss HP" value={x ? x.ratio / top : 0} className="text-rose-400" />
                <p className="text-mute">
                  {x
                    ? `worst ${DAYS[x.worst.dow].slice(0, 3)} ${slotLabel(x.worst.slot)} (${Math.round(x.worst.median_min)}m) vs best ${DAYS[x.best.dow].slice(0, 3)} ${slotLabel(x.best.slot)} (${Math.round(x.best.median_min)}m)`
                    : "collecting data… boss still loading."}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
