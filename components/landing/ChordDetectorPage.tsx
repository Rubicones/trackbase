"use client";

/**
 * /tools/chord-detector — free chord detector (server-side analysis).
 *
 * Uses the same Essentia pipeline as the structure editor's "Detect" button
 * (lib/serverChordDetection.ts, backed by public/workers/chordsWorker.js).
 * Uploaded audio is analyzed on the server and discarded — nothing is stored.
 *
 * Flow: upload → confirm tempo + time signature → analyze → results.
 * Time signature defaults to 4/4 when not changed.
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
import { CHORD_DETECTOR_FAQS } from "@/lib/seo";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_EXTENSIONS = ["mp3", "wav", "flac", "ogg", "m4a"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");
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
      Upload a track, confirm the tempo and time signature, get a chord-by-chord timeline with
      timestamps, bar numbers, and key. Free — no sign-up, up to 5 analyses per hour.
    </SliceHero>
  );
}

/* ============================================================
 * Detector — upload → confirm tempo/time signature → analyze → results
 * ============================================================ */

type Stage = "idle" | "confirm" | "analyzing" | "ready";

interface DetectedChord {
  timestamp_ms: number;
  chord: string;
}

interface AnalysisResult {
  key: string;
  duration_seconds: number;
  chords: DetectedChord[];
  filename: string;
  bpm: number;
  timeSig: string;
  audioUrl: string;
}

type ChordRow = {
  startSec: number;
  endSec: number;
  startBar: number;
  endBar: number;
  chord: string;
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "This file is too large. Please upload a file under 10 MB.";
  }
  if (!ACCEPTED_EXTENSIONS.includes(extOf(file.name))) {
    return "Unsupported file type. Please use MP3, WAV, FLAC, OGG, or M4A.";
  }
  return null;
}

function barNumber(timestampSec: number, bpm: number, timeSig: string): number {
  const barDurSec = barDurationSec(bpm, timeSig);
  return Math.floor(timestampSec / barDurSec) + 1;
}

function buildRows(analysis: AnalysisResult): ChordRow[] {
  const { chords, duration_seconds, bpm, timeSig } = analysis;
  return chords.map((c, i) => {
    const startSec = c.timestamp_ms / 1000;
    const endSec = i + 1 < chords.length ? chords[i + 1].timestamp_ms / 1000 : duration_seconds;
    const startBar = barNumber(startSec, bpm, timeSig);
    const endBar = barNumber(Math.max(startSec, endSec - 0.001), bpm, timeSig);
    return { startSec, endSec, startBar, endBar, chord: c.chord };
  });
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bpmInput, setBpmInput] = useState("");
  const [timeSig, setTimeSig] = useState<string>("4/4");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{ message: string; showSignup?: boolean } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduce = useReducedMotion();

  const bpmValue = parseBpmInput(bpmInput);
  const rows = useMemo(() => (analysis ? buildRows(analysis) : []), [analysis]);

  useEffect(() => {
    return () => {
      if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl);
    };
  }, [analysis?.audioUrl]);

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

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    const err = validateFile(file);
    setServerError(null);
    if (err) {
      setErrorMessage(err);
      setSelectedFile(null);
      setStage("idle");
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);
    setAnalysis(null);
    setT(0);
    setPlaying(false);
    setStage("confirm");
  }

  async function runAnalysis() {
    if (!selectedFile || bpmValue === null) return;
    setStage("analyzing");
    setErrorMessage(null);
    setServerError(null);

    try {
      const fd = new FormData();
      fd.set("file", selectedFile);
      fd.set("bpm", String(bpmValue));
      fd.set("time_signature", timeSig);

      const res = await fetch("/api/tools/chord-detector", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        key?: string;
        duration_seconds?: number;
        chords?: DetectedChord[];
        error?: string;
      };

      if (!res.ok) {
        if (res.status === 429) {
          setServerError({
            message: data.error ?? "You've reached the limit of 5 analyses per hour.",
            showSignup: true,
          });
        } else {
          setErrorMessage(data.error ?? "Something went wrong during analysis. Please try again or try a different file.");
        }
        setStage("confirm");
        return;
      }

      if (!data.chords?.length) {
        setErrorMessage(
          "Couldn't find clear chords in this clip — try a recording with more harmonic content (piano, guitar, keys), or trim it to 30–90s.",
        );
        setStage("confirm");
        return;
      }

      if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl);

      setAnalysis({
        key: data.key ?? "Unknown",
        duration_seconds: data.duration_seconds ?? 0,
        chords: data.chords,
        filename: selectedFile.name,
        bpm: bpmValue,
        timeSig,
        audioUrl: URL.createObjectURL(selectedFile),
      });
      setStage("ready");
    } catch {
      setErrorMessage("Something went wrong during analysis. Please try again or try a different file.");
      setStage("confirm");
    }
  }

  function reset() {
    if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl);
    setSelectedFile(null);
    setAnalysis(null);
    setStage("idle");
    setBpmInput("");
    setTimeSig("4/4");
    setErrorMessage(null);
    setServerError(null);
    setPlaying(false);
    setT(0);
    if (inputRef.current) inputRef.current.value = "";
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

  const activeRowIdx = useMemo(() => {
    if (!rows.length) return -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (t >= rows[i].startSec) return i;
    }
    return -1;
  }, [rows, t]);

  const duration = analysis?.duration_seconds ?? 0;

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
        <AnimatePresence>
          {serverError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden"
            >
              <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] p-4">
                <p className="font-mono-tb text-[11px] leading-relaxed text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]">
                  {serverError.message}
                </p>
                {serverError.showSignup && (
                  <Link
                    href="/"
                    className="font-mono-tb mt-2 inline-block text-[10px] uppercase tracking-[0.18em] text-lime underline-offset-4 hover:underline"
                  >
                    Sign up for unlimited access →
                  </Link>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`relative cursor-pointer border border-dashed transition-colors ${
              dragOver
                ? "border-lime bg-[color-mix(in_oklab,var(--lime)_8%,transparent)]"
                : "border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="px-6 py-16 text-center">
              <motion.div
                animate={reduce ? undefined : { y: [0, -4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-lime text-lime"
              >
                <IconUpload />
              </motion.div>
              <div className="font-mono-tb text-[12px] text-muted-foreground">
                Drag &amp; drop an audio file, or{" "}
                <span className="text-lime underline underline-offset-4">browse</span>
              </div>
              <div className="mt-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Max {Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB · {ACCEPTED_HINT}
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
        {stage === "confirm" && selectedFile && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <div className="truncate font-display-tb text-lg font-bold lowercase tracking-tight">{selectedFile.name}</div>
                <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
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
        {stage === "analyzing" && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] px-6 py-16 text-center"
          >
            <div className="mx-auto mb-4 size-10 animate-spin rounded-full border border-lime border-t-transparent" />
            <div className="font-mono-tb text-[12px] text-muted-foreground">
              analyzing <span className="text-lime">{selectedFile.name}</span>…
            </div>
            <div className="mt-3 flex justify-center gap-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>segmenting bars</span>
              <span>·</span>
              <span>fitting chords</span>
            </div>
            <p className="mt-4 font-mono-tb text-[10px] text-muted-foreground">Usually takes 10–30 seconds</p>
          </motion.div>
        )}

        {/* Ready — results */}
        <AnimatePresence>
          {stage === "ready" && analysis && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
            >
              <audio
                ref={audioRef}
                src={analysis.audioUrl}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="truncate font-display-tb text-lg font-bold lowercase tracking-tight">{analysis.filename}</div>
                  <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {fmtTime(duration)} ·{" "}
                    <span className="text-lime">
                      {analysis.bpm} bpm · {analysis.timeSig} · {analysis.key}
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
                      seekTo(((e.clientX - r.left) / r.width) * duration);
                    }}
                  >
                    <div className="absolute inset-y-0 left-0 bg-lime" style={{ width: `${duration > 0 ? (t / duration) * 100 : 0}%` }} />
                    <div
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime shadow"
                      style={{ left: `${duration > 0 ? (t / duration) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="shrink-0 font-mono-tb text-[10px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">
                  {fmtTime(t)} / {fmtTime(duration)}
                </div>
              </div>

              {/* Chord list */}
              <div className="max-h-[420px] overflow-auto">
                {rows.length === 0 ? (
                  <p className="px-4 py-6 font-mono-tb text-[11px] text-muted-foreground sm:px-5">
                    No chords detected — try a clip with more harmonic content.
                  </p>
                ) : (
                  rows.map((row, i) => {
                    const active = i === activeRowIdx;
                    const barsLabel = row.startBar === row.endBar ? `Bar ${row.startBar}` : `Bars ${row.startBar}–${row.endBar}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => seekTo(row.startSec)}
                        className={`grid w-full grid-cols-[minmax(90px,auto)_minmax(90px,auto)_1fr] items-center gap-4 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-2.5 text-left transition-colors sm:px-5 ${
                          active ? "bg-[color-mix(in_oklab,var(--lime)_10%,transparent)]" : "hover:bg-[color-mix(in_oklab,var(--card)_60%,transparent)]"
                        }`}
                      >
                        <span className={`font-mono-tb text-[11px] tabular-nums ${active ? "text-lime" : "text-muted-foreground"}`}>
                          {fmtTime(row.startSec)} — {fmtTime(row.endSec)}
                        </span>
                        <span className="font-mono-tb text-[11px] text-muted-foreground">{barsLabel}</span>
                        <span className={`font-display-tb text-base font-bold ${active ? "text-lime" : "text-foreground"}`}>
                          {row.chord}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-3 sm:px-5">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      rows
                        .map((row) =>
                          `${row.startBar === row.endBar ? `Bar ${row.startBar}` : `Bars ${row.startBar}-${row.endBar}`}  ${row.chord}`,
                        )
                        .join("\n"),
                    )
                  }
                  className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-1.5 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-lime hover:text-lime"
                >
                  copy chord list
                </button>
                <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {rows.length} chord changes detected
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

function ToolFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SliceSection index="faq" tag="chord detector faq">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display-tb text-[clamp(2rem,5vw,3.2rem)] font-bold leading-[0.95] tracking-[-0.02em]">
          Chord detector <span className="text-lime">FAQ.</span>
        </h2>
        <div className="mt-8 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
          {CHORD_DETECTOR_FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.question} className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
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
                    {item.question}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className={`shrink-0 font-mono-tb text-lg leading-none ${isOpen ? "text-lime" : "text-muted-foreground"}`}
                  >
                    +
                  </motion.span>
                </button>
                {/* Keep answers in the DOM for crawlers; only visually collapse when closed. */}
                <div
                  id={`tool-faq-panel-${i}`}
                  role="region"
                  className={isOpen ? "block" : "hidden"}
                >
                  <p className="pb-5 pr-8 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </div>
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
