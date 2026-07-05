"use client";

/**
 * /tools/chord-detector — free, client-side chord detector.
 *
 * Runs the same Essentia engine as the real per-section detector
 * (lib/chordDetection.ts + public/workers/chordsWorker.js): the uploaded
 * file is decoded and analyzed entirely in the browser, nothing is
 * uploaded to a server.
 *
 * Flow is intentionally different from a generic "drop file → instant
 * result" tool: chord detection is bar-quantized, so it needs a tempo and
 * time signature *before* analysis can start (that's how a "bar" is
 * defined). Time signature defaults to 4/4 if left as-is; tempo has no
 * safe default, so it's required.
 */

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SlicePage,
  SliceNav,
  ScopeBanner,
  SliceFooter,
  SliceSection,
  SliceHero,
  SliceMono,
} from "@/components/landing/SliceChrome";
import { useLandingAuth } from "@/hooks/useLandingAuth";
import { PROJECT_TIME_SIGNATURES, barDurationSec } from "@/lib/metronomeAudio";
import { detectChordsInAudio } from "@/lib/chordDetection";
import { parseChordsString, expandChordsToBarNames } from "@/lib/chords";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_ANALYZE_SEC = 5 * 60; // cap analysis to the first 5 minutes
const ACCEPTED_HINT = "MP3, WAV, FLAC, OGG, M4A";

export default function ChordDetectorPage() {
  return (
    <SlicePage>
      <SliceNav kind="feature" label="chord detector" />
      <ScopeBanner kind="feature">Chord detector is a free tool — sonicdesk is the workspace it lives in.</ScopeBanner>
      <Hero />
      <Detector />
      <WhyMore />
      <ToolFaq />
      <SliceFooter kind="feature" label="chord detector" />
    </SlicePage>
  );
}

/* ============================================================
 * Hero
 * ============================================================ */

function Hero() {
  return (
    <SliceHero
      pill="Free tool · no sign-up"
      title={
        <>
          FREE <span className="text-lime">CHORD DETECTOR.</span>
        </>
      }
    >
      Upload a track, confirm the tempo, get a chord-by-chord timeline with timestamps and bar
      numbers. Runs in your browser — no sign-up, no upload to a server.
    </SliceHero>
  );
}

/* ============================================================
 * Detector — upload → confirm tempo/time signature → analyze → results
 * ============================================================ */

type Stage = "idle" | "confirm" | "analyzing" | "ready";

type Decoded = {
  file: File;
  mono: Float32Array;
  sampleRate: number;
  duration: number;
  objectUrl: string;
};

type ChordGroup = {
  chord: string;
  startBar: number;
  endBar: number;
  start: number;
  end: number;
};

type Result = {
  groups: ChordGroup[];
  barDurSec: number;
  analyzedDurationSec: number;
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / numberOfChannels;
  }
  return out;
}

function groupBarChords(names: string[], barDurSec: number): ChordGroup[] {
  const groups: ChordGroup[] = [];
  let i = 0;
  while (i < names.length) {
    const name = names[i];
    let j = i + 1;
    while (j < names.length && names[j] === name) j += 1;
    groups.push({
      chord: name,
      startBar: i + 1,
      endBar: j,
      start: i * barDurSec,
      end: j * barDurSec,
    });
    i = j;
  }
  return groups;
}

function parseBpmInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 40 || n > 300) return null;
  return Math.round(n);
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 16V4M12 4l-5 5M12 4l5 5M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}

function Detector() {
  const [stage, setStage] = useState<Stage>("idle");
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [bpmInput, setBpmInput] = useState("");
  const [timeSig, setTimeSig] = useState<string>("4/4");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduce = useReducedMotion();

  const bpmValue = parseBpmInput(bpmInput);

  // Revokes the previous object URL whenever `decoded` changes (new file) and
  // on unmount — the closure captures the `decoded` value from *this* render,
  // so each cleanup revokes the right URL instead of a stale one.
  useEffect(() => {
    return () => {
      if (decoded) URL.revokeObjectURL(decoded.objectUrl);
    };
  }, [decoded]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const el = audioRef.current;
      if (el) setT(el.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setErrorMessage(null);

    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|flac|ogg|m4a)$/i.test(file.name)) {
      setErrorMessage(`Unsupported file — try ${ACCEPTED_HINT}.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(`That file is over ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB — trim it down and try again.`);
      return;
    }

    setDecoding(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } finally {
        void ctx.close();
      }
      const mono = downmixToMono(buffer);
      setDecoded({
        file,
        mono,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        objectUrl: URL.createObjectURL(file),
      });
      setResult(null);
      setT(0);
      setPlaying(false);
      setStage("confirm");
    } catch {
      setErrorMessage(`Couldn't decode that file — try ${ACCEPTED_HINT}.`);
    } finally {
      setDecoding(false);
    }
  }

  async function runAnalysis() {
    if (!decoded || bpmValue === null) return;
    setStage("analyzing");
    setErrorMessage(null);
    try {
      const barDurSec = barDurationSec(bpmValue, timeSig);
      const analyzedDurationSec = Math.min(decoded.duration, MAX_ANALYZE_SEC);
      const barCount = Math.max(1, Math.round(analyzedDurationSec / barDurSec));
      const sampleCount = Math.min(decoded.mono.length, Math.round(analyzedDurationSec * decoded.sampleRate));
      const slice = decoded.mono.subarray(0, sampleCount);

      const chordString = await detectChordsInAudio(slice, {
        sampleRate: decoded.sampleRate,
        barDurationSec: barDurSec,
        barCount,
      });

      if (!chordString.trim()) {
        setErrorMessage(
          "Couldn't find clear chords in this clip — try a recording with more harmonic content (piano, guitar, keys), or trim it to 30–90s.",
        );
        setStage("confirm");
        return;
      }

      const names = expandChordsToBarNames(parseChordsString(chordString));
      const groups = groupBarChords(names, barDurSec);
      setResult({ groups, barDurSec, analyzedDurationSec });
      setStage("ready");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong analyzing this file.");
      setStage("confirm");
    }
  }

  function reset() {
    setDecoded(null);
    setResult(null);
    setStage("idle");
    setBpmInput("");
    setTimeSig("4/4");
    setErrorMessage(null);
    setPlaying(false);
    setT(0);
  }

  function seekTo(sec: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = sec;
    setT(sec);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  }

  const activeGroupIdx = useMemo(() => {
    if (!result) return -1;
    return result.groups.findIndex((g) => t >= g.start && t < g.end);
  }, [result, t]);

  return (
    <SliceSection index="tool" tag="upload · confirm tempo · analyze">
      {/* Tips */}
      <div className="mx-auto mb-6 max-w-3xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
        <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">For best results</div>
        <ul className="mt-3 space-y-1.5 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
          <li>· Harmonic content — piano, guitar, keys, pads — analyzes cleanest.</li>
          <li>· Single-note melodies aren&apos;t chords; detection needs stacked notes.</li>
          <li>· Heavy drums &amp; bass can muddy things — try a stems-only pass if you have one.</li>
          <li>· 30–90 second clips are faster and more accurate than full songs.</li>
        </ul>
      </div>

      <div className="mx-auto max-w-3xl">
        {/* Idle — dropzone */}
        {stage === "idle" && (
          <motion.div
            layout
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => !decoding && inputRef.current?.click()}
            className={`relative cursor-pointer border border-dashed transition-colors ${
              dragOver
                ? "border-lime bg-[color-mix(in_oklab,var(--lime)_8%,transparent)]"
                : "border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="px-6 py-16 text-center">
              <motion.div
                animate={reduce ? undefined : { y: [0, -4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-lime text-lime"
              >
                {decoding ? (
                  <span className="size-5 animate-spin rounded-full border border-lime border-t-transparent" />
                ) : (
                  <IconUpload />
                )}
              </motion.div>
              <div className="font-mono-tb text-[12px] text-muted-foreground">
                {decoding ? (
                  "reading file…"
                ) : (
                  <>
                    Drag &amp; drop an audio file, or{" "}
                    <span className="text-lime underline underline-offset-4">browse</span>
                  </>
                )}
              </div>
              <div className="mt-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Max {Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB · {ACCEPTED_HINT}
              </div>
            </div>
          </motion.div>
        )}

        {stage === "idle" && errorMessage && (
          <p className="mt-4 text-center font-mono-tb text-[11px] leading-relaxed text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]">
            {errorMessage}
          </p>
        )}

        {/* Confirm — tempo + time signature before analysis */}
        {stage === "confirm" && decoded && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <div className="truncate font-display-tb text-lg font-bold lowercase tracking-tight">{decoded.file.name}</div>
                <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {fmtTime(decoded.duration)} duration
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-lime"
              >
                choose a different file →
              </button>
            </div>

            <div className="px-4 py-5 sm:px-5">
              <p className="font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
                Chord detection is bar-quantized — confirm the tempo (and time signature, if it&apos;s not 4/4)
                so bars line up before analysis starts.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    Tempo (BPM) — required
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bpmInput}
                    onChange={(e) => setBpmInput(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                    placeholder="e.g. 120"
                    className="w-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-background px-3 py-2 font-mono-tb text-sm text-foreground outline-none transition-colors focus:border-lime"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    Time signature
                  </span>
                  <select
                    value={timeSig}
                    onChange={(e) => setTimeSig(e.target.value)}
                    className="w-full cursor-pointer border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-background px-3 py-2 font-mono-tb text-sm text-foreground outline-none transition-colors focus:border-lime"
                  >
                    {PROJECT_TIME_SIGNATURES.map((ts) => (
                      <option key={ts} value={ts}>
                        {ts === "4/4" ? "4/4 (default)" : ts}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="mt-3 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
                Not sure of the tempo? Check it in your DAW or a tap-tempo app — most songs sit between 80
                and 140 BPM. Leave time signature on 4/4 if you&apos;re not sure.
              </p>

              {errorMessage && (
                <p className="mt-4 font-mono-tb text-[11px] leading-relaxed text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]">
                  {errorMessage}
                </p>
              )}

              <button
                type="button"
                disabled={bpmValue === null}
                onClick={() => void runAnalysis()}
                className="tb-btn-accent mt-6 inline-flex items-center gap-2 bg-lime px-6 py-3 text-[11px] uppercase text-primary-foreground transition-[transform,colors] disabled:pointer-events-none disabled:opacity-40"
              >
                Analyze chords →
              </button>
            </div>
          </motion.div>
        )}

        {/* Analyzing */}
        {stage === "analyzing" && decoded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] px-6 py-16 text-center"
          >
            <div className="mx-auto mb-4 size-10 animate-spin rounded-full border border-lime border-t-transparent" />
            <div className="font-mono-tb text-[12px] text-muted-foreground">
              analyzing <span className="text-lime">{decoded.file.name}</span>…
            </div>
            <div className="mt-3 flex justify-center gap-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>segmenting bars</span>
              <span>·</span>
              <span>fitting chords</span>
            </div>
          </motion.div>
        )}

        {/* Ready — results */}
        <AnimatePresence>
          {stage === "ready" && decoded && result && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
            >
              {/* Hidden audio element drives real playback */}
              <audio
                ref={audioRef}
                src={decoded.objectUrl}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="truncate font-display-tb text-lg font-bold lowercase tracking-tight">{decoded.file.name}</div>
                  <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {fmtTime(decoded.duration)} ·{" "}
                    <span className="text-lime">
                      {bpmValue} bpm · {timeSig}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-lime"
                >
                  analyze another file →
                </button>
              </div>

              {result.analyzedDurationSec < decoded.duration && (
                <div className="border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:px-5">
                  Showing chords for the first {fmtTime(result.analyzedDurationSec)} — trim longer files for full coverage.
                </div>
              )}

              {/* Transport */}
              <div className="flex items-center gap-4 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-4 sm:px-5">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-lime text-primary-foreground transition-transform hover:scale-105"
                >
                  {playing ? <IconPause /> : <IconPlay />}
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className="relative h-2 cursor-pointer bg-[color-mix(in_oklab,var(--border)_80%,transparent)]"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekTo(((e.clientX - r.left) / r.width) * decoded.duration);
                    }}
                  >
                    <div className="absolute inset-y-0 left-0 bg-lime" style={{ width: `${(t / decoded.duration) * 100}%` }} />
                    <div
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime shadow"
                      style={{ left: `${(t / decoded.duration) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="shrink-0 font-mono-tb text-[10px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">
                  {fmtTime(t)} / {fmtTime(decoded.duration)}
                </div>
              </div>

              {/* Chord list */}
              <div className="max-h-[420px] overflow-auto">
                {result.groups.map((g, i) => {
                  const active = i === activeGroupIdx;
                  const barsLabel = g.startBar === g.endBar ? `Bar ${g.startBar}` : `Bars ${g.startBar}–${g.endBar}`;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seekTo(g.start)}
                      className={`grid w-full grid-cols-[minmax(90px,auto)_minmax(90px,auto)_1fr] items-center gap-4 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-2.5 text-left transition-colors sm:px-5 ${
                        active ? "bg-[color-mix(in_oklab,var(--lime)_10%,transparent)]" : "hover:bg-[color-mix(in_oklab,var(--card)_60%,transparent)]"
                      }`}
                    >
                      <span className={`font-mono-tb text-[11px] tabular-nums ${active ? "text-lime" : "text-muted-foreground"}`}>
                        {fmtTime(g.start)} — {fmtTime(g.end)}
                      </span>
                      <span className="font-mono-tb text-[11px] text-muted-foreground">{barsLabel}</span>
                      <span className={`font-display-tb text-base font-bold ${active ? "text-lime" : "text-foreground"}`}>
                        {g.chord}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-3 sm:px-5">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      result.groups
                        .map((g) => `${g.startBar === g.endBar ? `Bar ${g.startBar}` : `Bars ${g.startBar}-${g.endBar}`}  ${g.chord}`)
                        .join("\n"),
                    )
                  }
                  className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-1.5 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-lime hover:text-lime"
                >
                  copy chord list
                </button>
                <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {result.groups.length} chord changes detected
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SliceSection>
  );
}

/* ============================================================
 * Why sonicdesk is more than this tool
 * ============================================================ */

function WhyMore() {
  const { authHref } = useLandingAuth();
  const feats: { t: string; d: string }[] = [
    { t: "Attach chords to tracks", d: "Chord charts live over your actual audio, not in a separate note app." },
    { t: "Version every idea", d: "Branch a chorus, keep master untouched, A/B compare in one click." },
    { t: "Comments on bars", d: "Point-in-time feedback pinned to the exact bar it's about." },
    { t: "Rehearsal mode", d: "Big chords, structure, and a metronome — built for the phone stand." },
    { t: "One room for the band", d: "Chat, resources, roadmap — everything the group needs, in one place." },
    { t: "Mobile mixer", d: "The workspace fits in your pocket. Rehearse, review, react anywhere." },
  ];

  return (
    <SliceSection index="more" tag="chord detector is one piece">
      <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="font-display-tb text-[clamp(2.2rem,6vw,4rem)] font-bold leading-[0.95] tracking-[-0.02em] text-balance">
            This tool is a <span className="text-lime">crumb.</span> sonicdesk is the meal.
          </h2>
          <SliceMono className="mt-6 max-w-xl">
            Chord detection is one bite of what we do. sonicdesk is a full workspace built for musicians
            and bands — versions, comments, structure, chords, chat, resources, mobile rehearsal — one
            place, one truth, no scattered files.
          </SliceMono>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="tb-btn-accent group inline-flex items-center gap-2 bg-lime px-6 py-3 text-[11px] uppercase text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              See the full workspace
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href={authHref}
              className="inline-flex items-center gap-2 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-5 py-3 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-lime hover:text-lime"
            >
              Try sonicdesk free
            </Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {feats.map((f, i) => (
            <motion.div
              key={f.t}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.06 }}
              className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4 transition-colors hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)]"
            >
              <div className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-lime">0{i + 1}</div>
              <div className="mt-2 font-display-tb text-base font-bold">{f.t}</div>
              <div className="mt-1.5 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">{f.d}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </SliceSection>
  );
}

/* ============================================================
 * Tool-specific FAQ (single-open accordion, no tag filter)
 * ============================================================ */

const TOOL_FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: "Is this chord detector really free?",
    a: "Yes. Upload a track, confirm the tempo, get chords back with timestamps and bar numbers — no sign-up, no credit card.",
  },
  {
    q: "How do I find the chords of a song?",
    a: "Upload an MP3, WAV, FLAC, OGG or M4A (up to 25 MB), confirm the tempo (and time signature, if it's not 4/4), and you get a chord-by-chord timeline with timestamps and bar numbers.",
  },
  {
    q: "Why do you ask for tempo before analyzing?",
    a: "Chord detection is bar-quantized — one chord per bar — and a bar's length is defined by tempo and time signature. Get those right first and the bar boundaries (and the chords) line up correctly.",
  },
  {
    q: "What if I don't know the time signature?",
    a: "Leave it on 4/4 — that's the default and it's correct for the large majority of songs.",
  },
  {
    q: "What kind of audio works best?",
    a: "Recordings with clear harmonic content — piano, guitar, keys, pads — analyze most accurately. Melody-only lines, heavy drums, and dense bass can reduce accuracy. A 30–90 second clip works best.",
  },
  {
    q: "Do you keep my audio?",
    a: "No. The file is decoded and analyzed entirely in your browser — nothing is uploaded to a server, and nothing is stored once you close the tab.",
  },
];

function ToolFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SliceSection index="faq" tag="chord detector faq">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display-tb text-[clamp(2rem,5vw,3.2rem)] font-bold leading-[0.95] tracking-[-0.02em]">
          Chord detector <span className="text-lime">FAQ.</span>
        </h2>
        <div className="mt-8 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
          {TOOL_FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`tool-faq-panel-${i}`}
                  className="tb-no-press-scale group flex w-full items-center justify-between gap-4 py-5 text-left"
                >
                  <span
                    className={`font-mono-tb text-[11px] uppercase tracking-[0.18em] transition-colors ${
                      isOpen ? "text-lime" : "text-foreground group-hover:text-lime"
                    }`}
                  >
                    {item.q}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className={`shrink-0 font-mono-tb text-lg leading-none ${isOpen ? "text-lime" : "text-muted-foreground"}`}
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`tool-faq-panel-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pb-5 pr-8 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-10 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-6 text-center">
          <p className="font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
            Want to attach chord charts to your tracks, collaborate with your band, and version your demos?
          </p>
          <Link
            href="/"
            className="tb-btn-accent mt-5 inline-flex items-center gap-2 bg-lime px-6 py-3 text-[11px] uppercase text-primary-foreground transition-transform hover:scale-[1.02]"
          >
            Try sonicdesk →
          </Link>
        </div>
      </div>
    </SliceSection>
  );
}
