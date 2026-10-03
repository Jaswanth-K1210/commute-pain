import Link from "next/link";
import { redirect } from "next/navigation";
import { MAX_PER_USER, ObjectId, getRoutes } from "@/lib/db";
import { getSession } from "@/lib/session";
import { deleteCommute, logout } from "../actions";
import AddCommute from "./AddCommute";

export const metadata = { title: "Profile · Commute Pain" };

export default async function Me() {
  const me = await getSession();
  if (!me) redirect("/");
  const routes = await getRoutes({ owner_id: new ObjectId(me.id) });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className="card flex items-center gap-4 bg-butter p-4">
        <span className="bob text-4xl" style={{ ["--r" as string]: "4deg" }}>🧃</span>
        <div className="min-w-0 flex-1">
          <p className="font-pixel text-[9px] text-mute">PLAYER 1</p>
          <h1 className="font-pixel mt-1 truncate text-sm">@{me.name}</h1>
        </div>
        <form action={logout}><button className="chip press bg-paper">LOG OUT</button></form>
      </section>

      <section>
        <h2 className="font-pixel mb-3 text-[11px] text-mute">YOUR COMMUTES ({routes.length}/{MAX_PER_USER})</h2>
        <ul className="space-y-3">
          {routes.map((r) => (
            <li key={r.id} className="card flex items-center gap-3 p-3">
              <Link href={`/route/${r.slug}`} className="min-w-0 flex-1">
                <p className="font-pixel text-[10px] leading-relaxed [overflow-wrap:anywhere]">{r.name}</p>
                <p className="truncate text-mute">{r.origin_label} → {r.dest_label}</p>
              </Link>
              <Link href={`/radio/${r.slug}`} className="chip press bg-lilac" aria-label="radio">📻</Link>
              <form action={deleteCommute}>
                <input type="hidden" name="id" value={r.id} />
                <button className="chip press bg-pink" aria-label={`delete ${r.name}`}>✕</button>
              </form>
            </li>
          ))}
          {!routes.length && <li className="text-mute">no commutes yet. add one below 👇</li>}
        </ul>
      </section>

      {routes.length < MAX_PER_USER && <AddCommute />}
    </div>
  );
}
