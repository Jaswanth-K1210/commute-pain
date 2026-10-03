"use client";

import { useActionState, useState } from "react";
import { addCommute } from "../actions";

type Place = { label: string; lat: number; lng: number };

function PlacePicker({ name, title, hint }: { name: string; title: string; hint: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(null);
  const [msg, setMsg] = useState("");

  // Search on button/enter only (not per keystroke) to save the TomTom quota.
  const search = async () => {
    if (q.trim().length < 3) return setMsg("type at least 3 letters");
    setMsg("searching…");
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => ({ error: "offline?" }));
    setResults(res.results ?? []);
    setMsg(res.error ?? (res.results?.length ? "" : "nothing found, try a landmark"));
  };

  return (
    <fieldset className="space-y-2">
      <legend className="font-pixel text-[10px]">{title}</legend>
      <input type="hidden" name={name} value={picked ? JSON.stringify(picked) : ""} />
      {picked ? (
        <p className="flex items-center gap-2 rounded border-2 border-ink bg-mint px-3 py-2">
          <span className="min-w-0 flex-1 truncate">📍 {picked.label}</span>
          <button type="button" className="underline" onClick={() => setPicked(null)}>change</button>
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={hint}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
              className="min-w-0 flex-1 rounded border-[3px] border-ink bg-cream px-3 py-1 text-xl outline-none focus:bg-butter"
            />
            <button type="button" onClick={search} className="chip press bg-sky">FIND</button>
          </div>
          {msg && <p className="text-mute">{msg}</p>}
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={i}>
                <button type="button" onClick={() => { setPicked(r); setResults([]); }} className="w-full truncate rounded px-2 text-left hover:bg-butter">
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}

export default function AddCommute() {
  const [state, action, pending] = useActionState(addCommute, undefined);
  return (
    <form action={action} className="card space-y-5 p-4">
      <h2 className="font-pixel text-[11px]">+ NEW COMMUTE</h2>
      <PlacePicker name="from" title="START (office?)" hint="e.g. Mindspace Madhapur" />
      <PlacePicker name="to" title="DESTINATION (home?)" hint="e.g. Kukatpally Housing Board" />
      {state?.error && <p className="rounded border-2 border-ink bg-pink px-3 py-1">⚠ {state.error}</p>}
      {state?.ok && <p className="rounded border-2 border-ink bg-mint px-3 py-1">✓ {state.ok}</p>}
      <button disabled={pending} className="card press font-pixel w-full bg-butter py-3 text-[11px] disabled:opacity-60">
        {pending ? "SAVING…" : "▶ START TRACKING"}
      </button>
      <p className="text-mute">tip: add the reverse trip as a 2nd commute for mornings.</p>
    </form>
  );
}
