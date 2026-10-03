"use client";

import { useEffect, useRef, useState } from "react";
import { RemoteAudioTrack, Room, RoomEvent, Track, type Participant, type RemoteTrack, type RemoteTrackPublication, type TrackPublication } from "livekit-client";

type Line = { id: number; user: string; text: string; at: number };

const CODES = ["10-4 👍", "🚧 jam ahead", "✅ all clear", "🌧️ waterlogging", "🚨 accident", "🚓 checking ahead", "🐄 cow on road", "🚇 metro's faster rn"];
const RULES = [
  "🚗 driving? hands off. passengers & parked people only.",
  "🛣️ traffic talk only. no spam, no beef.",
  "⏱️ 15s per transmission · 10s cooldown on text",
  "🙅 no phone numbers, no doxxing",
  "👻 100% live: nothing is recorded or saved. tune out = it's gone.",
  "📡 end with “over”. it's the law (it isn't).",
];
const MAX_TX_MS = 15_000;
const TEXT_COOLDOWN_MS = 10_000;
const PHONE = /(\+?\d[\d\s-]{8,}\d)/;

// ---- walkie-talkie sound FX, all synthesized ----
function noise(ac: AudioContext, dur: number, vol: number) {
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
  src.start();
}
function beep(ac: AudioContext, freq: number, dur: number, delay = 0) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.value = 0.08;
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + delay);
  o.stop(ac.currentTime + delay + dur);
}
const squelch = (ac: AudioContext) => noise(ac, 0.16, 0.5);
const rogerBeep = (ac: AudioContext) => { beep(ac, 1400, 0.07); beep(ac, 1000, 0.09, 0.08); };

/** Incoming voice → band-limited + crunchy = handheld radio. */
function radioChain(ac: AudioContext): AudioNode[] {
  const hp = ac.createBiquadFilter();
  const lp = ac.createBiquadFilter();
  const ws = ac.createWaveShaper();
  hp.type = "highpass"; hp.frequency.value = 450;
  lp.type = "lowpass"; lp.frequency.value = 2600;
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = (6 * x) / (1 + 5 * Math.abs(x)); }
  ws.curve = c;
  return [hp, lp, ws];
}

export default function Radio({ slug, channel, ch, me }: { slug: string; channel: string; ch: number; me: string }) {
  const [on, setOn] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [rx, setRx] = useState<string | null>(null);
  const [tx, setTx] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const room = useRef<Room | null>(null);
  const ac = useRef<AudioContext | null>(null);
  const holding = useRef(false);
  const txTimer = useRef(0);
  const lastText = useRef(0);
  const speakers = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLUListElement>(null);

  const audio = () => (ac.current ??= new AudioContext());
  const addLine = (user: string, t: string) => setLines((l) => [...l, { id: Date.now() + Math.random(), user, text: t, at: Date.now() }].slice(-60));

  useEffect(() => () => { room.current?.disconnect(); }, []);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); }, [lines.length]);

  async function tuneIn() {
    setErr("");
    setConnecting(true);
    const a = audio();
    await a.resume(); // this tap unlocks audio playback
    squelch(a);
    try {
      const res = await fetch(`/api/radio/${slug}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);

      const r = new Room({ webAudioMix: { audioContext: a }, publishDefaults: { stopMicTrackOnMute: true }, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const refresh = () => setPeople([...r.remoteParticipants.values()].map((p) => p.name || p.identity));
      const talking = (pub: TrackPublication, p: Participant, isOn: boolean) => {
        if (pub.kind !== Track.Kind.Audio || p === r.localParticipant) return;
        if (isOn) { squelch(a); setRx(p.name || p.identity); } else { rogerBeep(a); setRx(null); }
      };

      r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p) => {
        if (!(track instanceof RemoteAudioTrack)) return;
        track.setWebAudioPlugins(radioChain(a));
        speakers.current?.appendChild(track.attach());
        if (!pub.isMuted) talking(pub, p, true); // first press publishes the mic = they're talking
      })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.TrackUnmuted, (pub, p) => talking(pub, p, true))
        .on(RoomEvent.TrackMuted, (pub, p) => talking(pub, p, false))
        .on(RoomEvent.ParticipantConnected, (p) => { refresh(); addLine("📡", `@${p.name} tuned in`); })
        .on(RoomEvent.ParticipantDisconnected, (p) => { refresh(); addLine("📡", `@${p.name} tuned out`); })
        .on(RoomEvent.DataReceived, (payload, p, _kind, topic) => {
          if (topic !== "cb" || !p) return;
          try {
            const t = String(JSON.parse(new TextDecoder().decode(payload)).text).slice(0, 140);
            addLine(p.name || p.identity, t);
            beep(a, 1800, 0.05);
          } catch {}
        })
        .on(RoomEvent.Disconnected, () => { room.current = null; setOn(false); setTx(false); setRx(null); setPeople([]); });

      await r.connect(j.url, j.token);
      await r.startAudio();
      room.current = r;
      refresh();
      setOn(true);
      addLine("📡", `you're on CH ${ch}. say hi 👋`);
    } catch (e) {
      setErr(`couldn't tune in: ${(e as Error).message || "no signal"} 📵`);
    } finally {
      setConnecting(false);
    }
  }

  async function startTx() {
    holding.current = true;
    if (!room.current) return setErr("tune in first 📻");
    if (tx) return;
    setErr("");
    try {
      await room.current.localParticipant.setMicrophoneEnabled(true);
    } catch {
      holding.current = false;
      return setErr("mic blocked 🎙️ allow it to talk (or just type)");
    }
    if (!holding.current) return stopTx(); // released while the mic was starting
    beep(audio(), 900, 0.06);
    setTx(true);
    txTimer.current = window.setTimeout(stopTx, MAX_TX_MS);
  }

  async function stopTx() {
    holding.current = false;
    clearTimeout(txTimer.current);
    setTx(false);
    await room.current?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    if (room.current) rogerBeep(audio());
  }

  async function sendText(t: string) {
    t = t.trim().slice(0, 140);
    if (!t) return;
    if (!room.current) return setErr("tune in first 📻");
    if (PHONE.test(t)) return setErr("no phone numbers on air 🙅");
    const wait = TEXT_COOLDOWN_MS - (Date.now() - lastText.current);
    if (wait > 0) return setErr(`breathe 😮‍💨 ${Math.ceil(wait / 1000)}s cooldown`);
    lastText.current = Date.now();
    setErr("");
    setText("");
    await room.current.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ text: t })), { reliable: true, topic: "cb" });
    addLine(me, t);
  }

  const status = tx ? `TX ▸ @${me} ON AIR` : rx ? `RX ◂ @${rx}` : on ? "SQUELCH · · · LISTENING" : connecting ? "SCANNING…" : "RADIO OFF";

  return (
    <div className="mx-auto max-w-md">
      <div ref={speakers} hidden />
      <div className="relative mx-auto mt-6 w-full">
        <div className="absolute -top-8 right-10 h-10 w-4 rounded-t border-[3px] border-b-0 border-ink bg-ink" aria-hidden />
        <div className="card relative bg-sky p-4">
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[9px]">COMMUTE-CB 3000</span>
            <span className={`h-3 w-3 rounded-full border-2 border-ink ${tx ? "bg-rose-500" : rx ? "blink bg-emerald-400" : on ? "bg-emerald-200" : "bg-paper"}`} aria-hidden />
          </div>

          <div className="mt-3 rounded border-[3px] border-ink bg-[#c9e8b9] p-3 font-pixel text-[#24401a]" role="status" aria-live="polite">
            <p className="flex justify-between text-[9px]"><span>CH {String(ch).padStart(2, "0")}</span><span>{on ? `👥 ${people.length + 1}` : ""}</span></p>
            <p className="mt-1 text-[10px] leading-relaxed [overflow-wrap:anywhere]">{channel}</p>
            <p className={`mt-2 text-[9px] ${tx || rx || connecting ? "blink" : ""}`}>{status}</p>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-4">
            <div className="grid grid-cols-6 gap-1.5" aria-hidden>
              {Array.from({ length: 18 }, (_, i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-ink/70" />)}
            </div>
            <button
              onClick={() => (on ? room.current?.disconnect() : tuneIn())} disabled={connecting}
              className={`chip press ${on ? "bg-mint" : "bg-butter"} disabled:opacity-60`} aria-pressed={on}
            >
              {on ? "🔊 ON" : connecting ? "…" : "⏻ TUNE IN"}
            </button>
          </div>

          <button
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startTx(); }}
            onPointerUp={stopTx}
            onPointerCancel={stopTx}
            onKeyDown={(e) => { if (e.key === " " && !e.repeat) { e.preventDefault(); startTx(); } }}
            onKeyUp={(e) => { if (e.key === " ") stopTx(); }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={!on}
            className={`font-pixel mt-4 w-full touch-none select-none rounded-xl border-[3px] border-ink py-6 text-xs shadow-[5px_5px_0_#2b2340] transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-50 ${tx ? "bg-rose-400" : "bg-pink"}`}
          >
            {tx ? "● ON AIR — RELEASE TO END" : on ? "HOLD TO TALK 🎙️" : "TUNE IN FIRST ↑"}
          </button>
          <p className="mt-2 text-center text-mute">hold (or hold space) · max 15s · say “over” 😌</p>
        </div>
      </div>

      {err && <p className="mt-4 rounded border-2 border-ink bg-pink px-3 py-1">⚠ {err}</p>}

      {on && (
        <p className="mt-4 text-mute">
          on this frequency: <b className="text-ink">@{me}</b>{people.map((p) => <span key={p}> · @{p}</span>)}
          {!people.length && " (just you rn… lonely highway 🌙)"}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {CODES.map((c) => (
          <button key={c} onClick={() => sendText(c)} disabled={!on} className="chip press bg-butter !text-[9px] disabled:opacity-50">{c}</button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); sendText(text); }} className="mt-3 flex gap-2">
        <input
          value={text} onChange={(e) => setText(e.target.value)} maxLength={140} placeholder="breaker breaker… what's the road like?"
          className="min-w-0 flex-1 rounded border-[3px] border-ink bg-paper px-3 py-1 text-xl outline-none focus:bg-butter"
        />
        <button disabled={!on || !text.trim()} className="chip press bg-mint disabled:opacity-50">SEND</button>
      </form>

      <section className="card mt-5 p-3">
        <h2 className="font-pixel text-[10px]">📜 LIVE LOG · VANISHES ON TUNE-OUT</h2>
        <ul ref={feed} className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {lines.map((m) => (
            <li key={m.id} className={`rounded border-2 border-ink px-2 py-1 ${m.user === me ? "ml-8 bg-lilac" : m.user === "📡" ? "border-dashed bg-paper text-mute" : "mr-8 bg-cream"}`}>
              {m.user !== "📡" && <p className="text-mute">@{m.user}</p>}
              <p className="[overflow-wrap:anywhere]">{m.text}</p>
            </li>
          ))}
          {!lines.length && <li className="text-mute">dead air. tune in and be the first: “breaker breaker, how&apos;s the flyover?” 📡</li>}
        </ul>
      </section>

      <section className="card mt-5 bg-butter p-3">
        <h2 className="font-pixel text-[10px]">📋 CHANNEL RULES</h2>
        <ul className="mt-2 space-y-1">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>
    </div>
  );
}
