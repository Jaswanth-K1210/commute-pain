"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { enter, forget } from "./actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "↵"];

export default function StartForm({ known }: { known?: string }) {
  const [state, action, pending] = useActionState(enter, undefined);
  const [pin, setPin] = useState("");
  const form = useRef<HTMLFormElement>(null);

  // Returning player: 4th digit auto-submits. New player presses ↵ / the button.
  const setDigits = (v: string) => {
    const next = v.replace(/\D/g, "").slice(0, 4);
    setPin(next);
    if (known && next.length === 4) setTimeout(() => form.current?.requestSubmit());
  };
  const press = (k: string) => (k === "⌫" ? setPin(pin.slice(0, -1)) : k === "↵" ? form.current?.requestSubmit() : setDigits(pin + k));

  return (
    <form ref={form} action={(fd) => { action(fd); setPin(""); }} className="card mt-6 space-y-4 p-5 text-left">
      {known ? (
        <>
          <p className="font-pixel text-[11px] leading-relaxed">WELCOME BACK<br /><span className="text-rose-500">@{known}</span></p>
          <input type="hidden" name="name" value={known} />
        </>
      ) : (
        <label className="block">
          <span className="font-pixel text-[10px]">PLAYER NAME</span>
          <input
            name="name" required minLength={2} maxLength={20} pattern="[A-Za-z0-9_]+" autoComplete="username"
            placeholder="traffic_survivor" autoCapitalize="none"
            className="mt-2 w-full rounded border-[3px] border-ink bg-cream px-3 py-2 text-2xl outline-none focus:bg-butter"
          />
          <span className="text-mute">new name = new player. taken name = enter its PIN.</span>
        </label>
      )}

      <label className="block">
        <span className="font-pixel text-[10px]">{known ? "ENTER PIN" : "SET / ENTER 4-DIGIT PIN"}</span>
        <input
          name="pin" value={pin} onChange={(e) => setDigits(e.target.value)}
          type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="current-password"
          className="mt-2 w-full rounded border-[3px] border-ink bg-cream px-3 py-2 text-center font-pixel text-2xl tracking-[0.6em] outline-none focus:bg-butter"
          aria-label="4 digit PIN"
        />
      </label>

      <div className="grid grid-cols-3 gap-2" aria-hidden>
        {KEYS.map((k) => (
          <button
            type="button" key={k} tabIndex={-1} onClick={() => press(k)}
            className={`press rounded border-[3px] border-ink py-2 text-2xl shadow-[3px_3px_0_#2b2340] ${k === "↵" ? "bg-mint" : "bg-paper"}`}
          >
            {k}
          </button>
        ))}
      </div>

      {state?.error && <p className="rounded border-2 border-ink bg-pink px-3 py-1">⚠ {state.error}</p>}

      <button disabled={pending} className="card press font-pixel w-full bg-butter py-3 text-xs disabled:opacity-60">
        {pending ? "LOADING…" : "▶ PRESS START"}
      </button>

      <div className="flex justify-between text-mute">
        <Link href="/leave" className="underline">just peeking 👀</Link>
        {known && <button formAction={forget} formNoValidate className="underline">not @{known}?</button>}
      </div>
    </form>
  );
}
