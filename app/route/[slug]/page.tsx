import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getRoute, getSlots } from "@/lib/db";
import { DAYS, MIN_SAMPLES, brag, extremes, istNow, slotLabel, type Slot } from "@/lib/pain";
import { HEAT } from "../../ui";
import DayChart from "./DayChart";

export async function generateMetadata({ params }: PageProps<"/route/[slug]">): Promise<Metadata> {
  const route = await getRoute((await params).slug);
  return { title: route ? `${route.name} · Commute Pain` : "Route not found" };
}

export default async function RoutePage({ params }: PageProps<"/route/[slug]">) {
  const route = await getRoute((await params).slug);
  if (!route) notFound();

  const slots = await getSlots(route.id);
  const x = extremes(slots);
  const line = brag(slots);
  const today = istNow().dow;
  const cell = new Map(slots.map((s) => [`${s.dow}-${s.slot}`, s]));
  const heat = (s: Slot) =>
    x ? HEAT[Math.round(((s.median_min - x.best.median_min) / (x.worst.median_min - x.best.median_min || 1)) * (HEAT.length - 1))] : HEAT[0];

  return (
    <>
      <h1 className="font-pixel text-lg leading-snug [overflow-wrap:anywhere] sm:text-2xl">{route.name}</h1>
      <p className="mt-1 font-pixel text-[9px] text-mute">{route.owner ? `@${route.owner.name}'s ride` : "community route"}</p>
      <p className="mt-2 text-mute">{line ? `${line}. you've been warned.` : "collecting data… come back after a few days of suffering."}</p>

      <Link href={`/radio/${route.slug}`} className="card press font-pixel mt-4 block bg-lilac px-4 py-3 text-[10px]">📻 TUNE IN TO THIS ROUTE&apos;S RADIO ▶</Link>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="card bg-pink p-3">
          <p className="font-pixel text-[9px]">☠ BOSS SLOT</p>
          <p className="mt-2 text-2xl leading-none">{x ? `${DAYS[x.worst.dow].slice(0, 3)} ${slotLabel(x.worst.slot)}` : "—"}</p>
          <p className="text-mute">{x ? `${Math.round(x.worst.median_min)} min median` : "need data"}</p>
        </div>
        <div className="card bg-mint p-3">
          <p className="font-pixel text-[9px]">★ SAFE ROOM</p>
          <p className="mt-2 text-2xl leading-none">{x ? `${DAYS[x.best.dow].slice(0, 3)} ${slotLabel(x.best.slot)}` : "—"}</p>
          <p className="text-mute">{x ? `${Math.round(x.best.median_min)} min median` : "need data"}</p>
        </div>
      </div>

      <section className="card mt-6 p-3">
        <h2 className="font-pixel mb-1 text-[11px]">TODAY ({DAYS[today].toUpperCase()}) · TYPICAL MINUTES</h2>
        <DayChart data={slots.filter((s) => s.dow === today && s.n >= MIN_SAMPLES).sort((a, b) => a.slot - b.slot).map((s) => ({ t: slotLabel(s.slot), min: s.median_min }))} />
      </section>

      <section className="card mt-6 p-3">
        <h2 className="font-pixel mb-1 text-[11px]">THE MAP OF PAIN</h2>
        <p className="mb-3 text-mute">median minutes · IST · “…” = fewer than {MIN_SAMPLES} samples, still collecting data…</p>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-[2px] text-center text-lg">
            <thead className="sticky top-0 bg-paper">
              <tr>
                <th />
                {DAYS.map((d, i) => (
                  <th key={d} className={`font-pixel text-[8px] ${i === today ? "underline" : ""}`}>{d.slice(0, 3).toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 36 }, (_, i) => i + 12).map((slot) => (
                <tr key={slot}>
                  <th className="pr-1 text-right font-normal whitespace-nowrap text-mute">{slotLabel(slot)}</th>
                  {DAYS.map((d, dow) => {
                    const s = cell.get(`${dow}-${slot}`);
                    const ok = s && s.n >= MIN_SAMPLES;
                    return (
                      <td
                        key={d}
                        title={s ? `${d} ${slotLabel(slot)}: ${s.median_min} min (n=${s.n})` : `${d} ${slotLabel(slot)}: no data`}
                        className="rounded-[3px] leading-7"
                        style={{ background: ok ? heat(s) : "#f3ece2", color: ok ? undefined : "#b3aac4" }}
                      >
                        {ok ? Math.round(s.median_min) : "…"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 text-center text-mute">📸 share this page's link: it brings its own trash-talk card.</p>
    </>
  );
}
