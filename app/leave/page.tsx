import Link from "next/link";
import { getLatest, getRoutes, getSlots, type Latest, type Route } from "@/lib/db";
import { DAYS, istNow, quip, slotLabel, verdict } from "@/lib/pain";
import { getSession } from "@/lib/session";
import { HpBar, LEVEL_STYLE } from "../ui";

const STALE_MS = 90 * 60_000; // older reading = logger missed runs; don't pretend it's live

export default async function LeaveNow() {
  const now = istNow();
  const me = await getSession();
  const [routes, latest] = await Promise.all([getRoutes(), getLatest()]);
  const slots = await Promise.all(routes.map((r) => getSlots(r.id)));

  const cards = routes.map((route, i) => {
    const l = latest.find((x) => x.route_id === route.id);
    const live = l && Date.now() - new Date(l.logged_at).getTime() < STALE_MS ? l : undefined;
    return { route, live, v: verdict(live ? live.duration_sec / 60 : null, slots[i], now), seed: i + now.slot };
  });
  const mine = cards.filter((c) => me && c.route.owner_id === me.id);
  const rest = cards.filter((c) => !mine.includes(c));

  return (
    <>
      <section className="mb-6">
        <p className="font-pixel text-[10px] text-mute">{DAYS[now.dow].toUpperCase()} · {slotLabel(now.slot)} IST</p>
        <h1 className="font-pixel mt-2 text-2xl leading-snug sm:text-4xl">LEAVE NOW?</h1>
        <p className="mt-2 max-w-xl text-mute">live traffic vs what this route usually looks like right now. pick your fighter.</p>
      </section>

      {me && (
        <Section title="YOUR RIDES">
          {mine.length ? mine.map((c) => <Card key={c.route.id} {...c} />) : (
            <Link href="/me" className="card press block bg-butter p-5">
              <p className="font-pixel text-[11px] leading-relaxed">+ ADD YOUR COMMUTE</p>
              <p className="mt-2 text-mute">tell us home & office, we start logging your pain in 30 min.</p>
            </Link>
          )}
        </Section>
      )}
      <Section title={me ? "COMMUNITY ROUTES" : "ALL ROUTES"}>
        {rest.length ? rest.map((c) => <Card key={c.route.id} {...c} />) : <p className="text-mute">no routes yet… is the DB set up?</p>}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-pixel mb-3 text-[11px] text-mute">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Card({ route, live, v, seed }: { route: Route; live?: Latest; v: ReturnType<typeof verdict>; seed: number }) {
  const st = LEVEL_STYLE[v.level];
  const current = live ? live.duration_sec / 60 : null;
  return (
    <div className="card overflow-hidden">
      <div className={`${st.bg} flex items-center justify-between border-b-[3px] border-ink px-3 py-2`}>
        <span className="font-pixel truncate text-[9px]">{route.owner_name ? `@${route.owner_name}` : "COMMUNITY"}</span>
        <span className="font-pixel shrink-0 text-xs">{v.level === "wait" && v.waitMin ? `WAIT ${v.waitMin} MIN` : st.label}</span>
      </div>
      <Link href={`/route/${route.slug}`} className="block space-y-3 p-4 hover:bg-cream">
        <h3 className="font-pixel text-[11px] leading-relaxed [overflow-wrap:anywhere]">{route.name}</h3>
        <div className="flex items-end gap-3">
          <span className="text-5xl leading-none">{current ? Math.round(current) : "--"}</span>
          <span className="pb-1 text-mute">
            min now{v.typical ? ` · usually ${Math.round(v.typical)}` : ""}
            {live && live.traffic_delay_sec >= 60 ? ` · +${Math.round(live.traffic_delay_sec / 60)} jam` : ""}
          </span>
        </div>
        <HpBar label="pain vs usual" value={v.ratio ? (v.ratio - 0.6) / 1.2 : 0} className={st.bar} />
        <p>“{quip(v.level, seed)}”</p>
        {v.next && (
          <p className="text-mute">▶ next best: <b className="text-ink">{slotLabel(v.next.slot)}</b> (~{Math.round(v.next.median_min)} min)</p>
        )}
        {!!live?.alternatives.length && (
          <p className="text-mute">
            🔀 other ways rn:{" "}
            {live.alternatives.map((a, i) => (
              <span key={i} className={a.duration_sec < live.duration_sec ? "text-emerald-600" : ""}>
                {i ? " · " : ""}{Math.round(a.duration_sec / 60)}m ({(a.distance_m / 1000).toFixed(1)}km)
              </span>
            ))}
          </p>
        )}
      </Link>
      <Link href={`/radio/${route.slug}`} className="font-pixel flex items-center justify-between border-t-[3px] border-ink bg-lilac px-3 py-2 text-[9px] hover:bg-sky">
        <span>📻 TUNE IN</span><span>CH {String(route.ch).padStart(2, "0")} ▶</span>
      </Link>
    </div>
  );
}
