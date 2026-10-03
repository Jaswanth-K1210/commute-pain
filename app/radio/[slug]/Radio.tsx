"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { id: number; kind: "text" | "voice"; body: string | null; url: string | null; user: string; created_at: string };

const CODES = ["10-4 👍", "🚧 jam ahead", "✅ all clear", "🌧️ waterlogging", "🚨 accident", "🚓 checking ahead", "🐄 cow on road", "🚇 metro's faster rn"];
const RULES = [
  "🚗 driving? hands off. passengers & parked people only.",
  "🛣️ traffic talk only. no spam, no beef.",
  "⏱️ 15s voice / 140 chars max · 10s cooldown",
  "🙅 no phone numbers, no doxxing",
  "💨 everything self-destructs after 3 hours",
  "📡 end with “over”. it's the law (it isn't).",
];
const POLL_MS = 4000;
const MAX_REC_MS = 15_000;

// ---- walkie-talkie sound FX, all synthesized (no audio files) ----
function noise(ac: AudioContext, dur: number, vol: number, at: number) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  const bp = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = buf;
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
}
function beep(ac: AudioContext, freq: number, dur: number, at = ac.currentTime) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.value = 0.08;
  o.connect(g).connect(ac.destination);
  o.start(at);
  o.stop(at + dur);
}
const squelch = (ac: AudioContext) => noise(ac, 0.16, 0.5, ac.currentTime);
const rogerBeep = (ac: AudioContext) => { beep(ac, 1400, 0.07); beep(ac, 1000, 0.09, ac.currentTime + 0.08); };

const crunch = (() => {
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = (6 * x) / (1 + 5 * Math.abs(x)); }
  return c;
})();

/** Play a clip through a "radio": band-limited, slightly crunchy, hiss underneath, squelch + roger beep. */
async function playRadio(ac: AudioContext, url: string) {
  squelch(ac);
  try {
    const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ac.createBufferSource();
    const hp = ac.createBiquadFilter();
    const lp = ac.createBiquadFilter();
    const ws = ac.createWaveShaper();
    src.buffer = buf;
    hp.type = "highpass"; hp.frequency.value = 450;
    lp.type = "lowpass"; lp.frequency.value = 2600;
    ws.curve = crunch;
    src.connect(hp).connect(lp).connect(ws).connect(ac.destination);
    const t0 = ac.currentTime + 0.15;
    noise(ac, buf.duration, 0.04, t0);
    src.start(t0);
    await new Promise((r) => (src.onended = r));
  } catch {
    // codec the browser can't decode into WebAudio (e.g. webm on old Safari): play it plain
    const a = new Audio(url);
    await a.play().catch(() => {});
    await new Promise((r) => (a.onended = r));
  }
  rogerBeep(ac);
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
};

export default function Radio({ slug, channel, ch, me }: { slug: string; channel: string; ch: number; me: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [on, setOn] = useState(false);
  const [rx, setRx] = useState<string | null>(null);
  const [tx, setTx] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const ac = useRef<AudioContext | null>(null);
  const onRef = useRef(false);
  const lastId = useRef(0);
  const queue = useRef<Msg[]>([]);
  const playing = useRef(false);
  const rec = useRef<{ mr: MediaRecorder; started: number; timer: number } | null>(null);
  const holding = useRef(false);
  const feed = useRef<HTMLUListElement>(null);

  const audio = () => (ac.current ??= new AudioContext());

  async function drain() {
    if (playing.current) return;
    playing.current = true;
    for (let m; (m = queue.current.shift()); ) {
      if (!m.url || !onRef.current) continue;
      setRx(m.user);
      await playRadio(audio(), m.url);
    }
    setRx(null);
    playing.current = false;
  }

  // Poll for new transmissions. ponytail: 4s polling; switch to Supabase Realtime if channels get busy.
  useEffect(() => {
    let alive = true, first = true, timer = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/radio/${slug}?after=${lastId.current}`);
        if (r.ok) {
          const { messages } = (await r.json()) as { messages: Msg[] };
          if (messages.length) {
            lastId.current = messages[messages.length - 1].id;
            setMsgs((old) => [...old, ...messages.filter((m) => !old.some((o) => o.id === m.id))].slice(-100));
            if (!first) {
              queue.current.push(...messages.filter((m) => m.kind === "voice" && m.user !== me));
              if (messages.some((m) => m.kind === "text" && m.user !== me) && onRef.current) beep(audio(), 1800, 0.05);
              drain();
            }
          }
          first = false;
        }
      } catch {}
      if (alive) timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [slug, me]);

  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

  const toggle = () => {
    onRef.current = !on;
    setOn(!on);
    const a = audio(); // first tap unlocks autoplay
    a.resume();
    if (!on) squelch(a);
  };

  async function send(body: FormData) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/radio/${slug}`, { method: "POST", body });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "transmission failed");
      setMsgs((old) => (old.some((o) => o.id === j.message.id) ? old : [...old, j.message]));
      if (onRef.current) rogerBeep(audio());
    } catch {
      setErr("no signal 📵");
    } finally {
      setBusy(false);
    }
  }

  const sendText = (t: string) => {
    if (!t.trim()) return;
    const fd = new FormData();
    fd.set("text", t.trim());
    send(fd);
    setText("");
  };

  async function startTx() {
    holding.current = true;
    if (rec.current || busy) return;
    setErr("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return setErr("mic blocked 🎙️ allow it to talk (or just type)");
    }
    const mr = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const took = Date.now() - (rec.current?.started ?? Date.now());
      clearTimeout(rec.current?.timer);
      rec.current = null;
      setTx(false);
      if (took < 700) return setErr("too short. hold the button while you talk");
      const fd = new FormData();
      fd.set("audio", new Blob(chunks, { type: mr.mimeType }), "clip");
      send(fd);
    };
    mr.start();
    beep(audio(), 900, 0.06);
    rec.current = { mr, started: Date.now(), timer: window.setTimeout(stopTx, MAX_REC_MS) };
    setTx(true);
    if (!holding.current) stopTx(); // released while the mic permission prompt was up
  }

  function stopTx() {
    holding.current = false;
    if (rec.current?.mr.state === "recording") rec.current.mr.stop();
  }

  const status = tx ? `TX ▸ @${me} ON AIR` : rx ? `RX ◂ @${rx}` : on ? "SQUELCH · · · LISTENING" : "RADIO OFF";

  return (
    <div className="mx-auto max-w-md">
      {/* the handheld */}
      <div className="relative mx-auto mt-6 w-full">
        <div className="absolute -top-8 right-10 h-10 w-4 rounded-t border-[3px] border-b-0 border-ink bg-ink" aria-hidden />
        <div className="card relative bg-sky p-4">
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[9px]">COMMUTE-CB 3000</span>
            <span className={`h-3 w-3 rounded-full border-2 border-ink ${tx ? "bg-rose-500" : rx ? "blink bg-emerald-400" : on ? "bg-emerald-200" : "bg-paper"}`} aria-hidden />
          </div>

          <div className="mt-3 rounded border-[3px] border-ink bg-[#c9e8b9] p-3 font-pixel text-[#24401a]" role="status" aria-live="polite">
            <p className="text-[9px]">CH {String(ch).padStart(2, "0")}</p>
            <p className="mt-1 text-[10px] leading-relaxed [overflow-wrap:anywhere]">{channel}</p>
            <p className={`mt-2 text-[9px] ${tx || rx ? "blink" : ""}`}>{status}</p>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-4">
            <div className="grid grid-cols-6 gap-1.5" aria-hidden>
              {Array.from({ length: 18 }, (_, i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-ink/70" />)}
            </div>
            <button onClick={toggle} className={`chip press ${on ? "bg-mint" : "bg-paper"}`} aria-pressed={on}>
              {on ? "🔊 ON" : "🔇 OFF"}
            </button>
          </div>

          <button
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startTx(); }}
            onPointerUp={stopTx}
            onPointerCancel={stopTx}
            onKeyDown={(e) => { if (e.key === " " && !e.repeat) { e.preventDefault(); startTx(); } }}
            onKeyUp={(e) => { if (e.key === " ") stopTx(); }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={busy}
            className={`font-pixel mt-4 w-full touch-none select-none rounded-xl border-[3px] border-ink py-6 text-xs shadow-[5px_5px_0_#2b2340] transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-60 ${tx ? "bg-rose-400" : "bg-pink"}`}
          >
            {tx ? "● ON AIR — RELEASE TO SEND" : busy ? "SENDING…" : "HOLD TO TALK 🎙️"}
          </button>
          <p className="mt-2 text-center text-mute">hold (or hold space) · max 15s · say “over” 😌</p>
        </div>
      </div>

      {err && <p className="mt-4 rounded border-2 border-ink bg-pink px-3 py-1">⚠ {err}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {CODES.map((c) => (
          <button key={c} onClick={() => sendText(c)} disabled={busy} className="chip press bg-butter !text-[9px]">{c}</button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); sendText(text); }} className="mt-3 flex gap-2">
        <input
          value={text} onChange={(e) => setText(e.target.value)} maxLength={140} placeholder="breaker breaker… what's the road like?"
          className="min-w-0 flex-1 rounded border-[3px] border-ink bg-paper px-3 py-1 text-xl outline-none focus:bg-butter"
        />
        <button disabled={busy || !text.trim()} className="chip press bg-mint disabled:opacity-50">SEND</button>
      </form>

      <section className="card mt-5 p-3">
        <h2 className="font-pixel text-[10px]">📜 CHANNEL LOG · LAST 3H</h2>
        <ul ref={feed} className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {msgs.map((m) => (
            <li key={m.id} className={`rounded border-2 border-ink px-2 py-1 ${m.user === me ? "ml-8 bg-lilac" : "mr-8 bg-cream"}`}>
              <p className="flex justify-between text-mute"><span>@{m.user}</span><span>{ago(m.created_at)}</span></p>
              {m.kind === "text" ? (
                <p className="[overflow-wrap:anywhere]">{m.body}</p>
              ) : (
                <button
                  className="underline"
                  onClick={() => { if (m.url) { setRx(m.user); playRadio(audio(), m.url).finally(() => setRx(null)); } }}
                >
                  ▶ voice clip
                </button>
              )}
            </li>
          ))}
          {!msgs.length && <li className="text-mute">dead air. be the first: “breaker breaker, how's the flyover?” 📡</li>}
        </ul>
      </section>

      <section className="card mt-5 bg-butter p-3">
        <h2 className="font-pixel text-[10px]">📋 CHANNEL RULES</h2>
        <ul className="mt-2 space-y-1">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>
    </div>
  );
}
