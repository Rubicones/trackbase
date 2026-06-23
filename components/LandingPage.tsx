"use client";

import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  AnimatePresence,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import {
  Users, Tag, Activity, BarChart3,
  GitBranch, GitMerge, History, Undo2,
  AudioWaveform, Volume2, Mic, Timer, MessageSquare,
  LayoutGrid, Music2, Layers, ListMusic,
  Piano, Boxes, MousePointer2,
  Paperclip, Link2, FileText, Compass, CheckSquare,
  Smartphone, Maximize2, Repeat,
  FileAudio, Share2, Eye, Hash,
  Disc3, KeyRound, Zap, Lightbulb, Check, Sparkles,
} from "lucide-react";

/* ============================================================
 * Primitive bits
 * ============================================================ */

function MonoLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono-tb text-[11px] uppercase tracking-[0.18em] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

function EmberTag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border border-[color-mix(in_oklab,var(--ember)_60%,transparent)] px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember ${className}`}
    >
      <span className="size-1.5 bg-ember tb-blink" />
      {children}
    </span>
  );
}

function SectionHeader({
  index,
  kicker,
  title,
  accent,
  description,
}: {
  index: string;
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
}) {
  return (
    <div className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] pb-8">
      <div className="mb-6 flex items-center justify-between">
        <MonoLabel>
          <span className="text-ember">{index}</span> · {kicker}
        </MonoLabel>
        <MonoLabel className="hidden md:inline">#{kicker.toLowerCase().replace(/\s+/g, "-")}</MonoLabel>
      </div>
      <h2
        className="font-display-tb text-[2.6rem] font-bold leading-[0.95] tracking-[-0.02em] text-foreground md:text-[3.75rem] lg:text-[4.5rem]"
        style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
      >
        {title}{" "}
        {accent && <span className="text-ember">{accent}</span>}
      </h2>
      {description && (
        <p className="mt-6 max-w-2xl font-mono-tb text-sm leading-relaxed text-muted-foreground md:text-base">
          {description}
        </p>
      )}
    </div>
  );
}

function GhostButton({
  children,
  variant = "ghost",
  className = "",
  href,
  ...rest
}: {
  children: ReactNode;
  variant?: "ghost" | "ember" | "outline";
  className?: string;
  href?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles =
    variant === "ember"
      ? "bg-ember text-primary-foreground hover:bg-(--ember-bright)"
      : variant === "outline"
        ? "border border-[color-mix(in_oklab,var(--foreground)_30%,transparent)] text-foreground hover:border-ember hover:text-ember"
        : "border border-border text-foreground hover:border-[color-mix(in_oklab,var(--ember)_60%,transparent)] hover:text-ember";

  const cls = `group relative inline-flex items-center gap-2 px-5 py-3 font-mono-tb text-[11px] uppercase tracking-[0.22em] transition-colors ${styles} ${className}`;

  if (href) {
    return <a href={href} className={cls}>{children}</a>;
  }
  return (
    <button {...rest} className={cls}>
      {children}
    </button>
  );
}

/* ============================================================
 * Rectangular waveform
 * ============================================================ */

function Waveform({
  seed = 1,
  bars = 64,
  color = "var(--wave-violet)",
  height = 88,
  active = true,
  density = 1,
}: {
  seed?: number;
  bars?: number;
  color?: string;
  height?: number;
  active?: boolean;
  density?: number;
}) {
  const values = Array.from({ length: bars }, (_, i) => {
    const x = Math.sin((i + 1) * seed * 12.9898) * 43758.5453;
    const r = x - Math.floor(x);
    const env = Math.sin((i / bars) * Math.PI) * 0.65 + 0.35;
    return Math.max(0.12, Math.min(1, r * 0.9 * env + 0.1)) * density;
  });
  return (
    <div className="flex h-full items-end gap-[2px]" style={{ height }}>
      {values.map((v, i) => (
        <motion.span
          key={i}
          initial={{ scaleY: 0.2, opacity: 0.4 }}
          whileInView={{ scaleY: 1, opacity: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{
            delay: i * 0.008,
            duration: 0.5,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            height: `${v * 100}%`,
            background: active
              ? color
              : "color-mix(in oklab, var(--foreground) 12%, transparent)",
            transformOrigin: "bottom",
            width: `${100 / bars}%`,
            minWidth: 4,
          }}
          className="block"
        />
      ))}
    </div>
  );
}

/* ============================================================
 * Top nav
 * ============================================================ */

function TopBar({ signInHref = "/auth" }: { signInHref?: string }) {
  const [time, setTime] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    update();
    const id = setInterval(update, 1000 * 30);
    return () => clearInterval(id);
  }, []);
  const navItems: Array<[string, string]> = [
    ["#bands", "BANDS"],
    ["#studios", "STUDIOS"],
    ["#mixer", "MIXER"],
    ["#system", "SYSTEM"],
    ["#themes", "THEMES"],
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_95%,transparent)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-6 md:gap-10">
          <a href="#top" className="flex shrink-0 items-center gap-2 text-foreground">
            <span
              className="font-display-tb text-base font-bold tracking-tight text-ember sm:text-lg"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              TRACKBASE
            </span>
            <span className="hidden font-mono-tb text-[10px] text-muted-foreground sm:inline">
              // v0.9
            </span>
          </a>
          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="font-mono-tb text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-ember"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground lg:inline-flex">
            <span className="size-1.5 rounded-full bg-(--signal) tb-blink" />
            SYS OK · {time || "00:00"}
          </span>
          <a
            href={signInHref}
            className="hidden items-center gap-2 bg-ember px-3 py-2 font-mono-tb text-[11px] uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-(--ember-bright) sm:inline-flex"
          >
            + SIGN IN
          </a>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            className="grid size-10 place-items-center border border-border text-foreground transition-colors hover:border-ember hover:text-ember md:hidden"
          >
            <motion.span animate={{ rotate: open ? 45 : 0, y: open ? 4 : 0 }} className="block h-px w-5 bg-current" />
            <motion.span animate={{ opacity: open ? 0 : 1 }} className="my-1 block h-px w-5 bg-current" />
            <motion.span animate={{ rotate: open ? -45 : 0, y: open ? -4 : 0 }} className="block h-px w-5 bg-current" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-background md:hidden"
          >
            <nav className="flex flex-col px-4 py-2">
              {navItems.map(([href, label], i) => (
                <motion.a
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i }}
                  className="group flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_40%,transparent)] py-3 font-mono-tb text-[12px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-ember"
                >
                  <span className="flex items-center gap-3">
                    <span className="size-1.5 bg-ember opacity-50 transition-opacity group-hover:opacity-100" />
                    {label}
                  </span>
                  <span className="text-ember opacity-0 transition-opacity group-hover:opacity-100">→</span>
                </motion.a>
              ))}
              <a
                href={signInHref}
                onClick={() => setOpen(false)}
                className="mt-3 mb-2 flex items-center justify-center gap-2 bg-ember px-4 py-3 font-mono-tb text-[11px] uppercase tracking-[0.22em] text-primary-foreground"
              >
                + SIGN IN
              </a>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
 * HERO
 * ============================================================ */

function Hero({ signInHref = "/auth" }: { signInHref?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);
  const reduce = useReducedMotion();

  return (
    <section
      ref={ref}
      id="top"
      className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] tb-grid-bg-landing"
    >
      {!reduce && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--ember)_60%,transparent)] to-transparent"
          initial={{ y: -200 }}
          animate={{ y: 1400 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        />
      )}

      <motion.div style={{ y, opacity }} className="relative px-4 pt-16 pb-28 md:px-8 md:pt-24 md:pb-36">
        <div className="mb-10 flex flex-wrap items-center gap-4">
          <EmberTag>BRANDBOOK V0.9 · NOW IN BETA</EmberTag>
          <MonoLabel>/ HOME BASE · BANDS · STUDIOS</MonoLabel>
        </div>

        <h1
          className="font-display-tb font-bold leading-[0.88] tracking-[-0.04em] text-foreground"
          style={{
            fontSize: "clamp(2.6rem, 9vw, 8.5rem)",
            fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)",
          }}
        >
          MUSIC IS A <br className="hidden sm:block" />
          <span className="text-ember">PROCESS</span>
          <span className="text-ember">.</span>{" "}
          <span className="text-muted-foreground">NOT A FILE.</span>
        </h1>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <p className="max-w-xl font-mono-tb text-[15px] leading-relaxed text-muted-foreground md:text-base">
            A track doesn't arrive finished. It moves through dozens of iterations, arguments,
            voice memos and renamed exports. TrackBase is the collaborative surface where bands
            think, branch and decide together — versioned, structured, indexed.
          </p>

          <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <MonoLabel>ACTIVE PROJECT · MAIN</MonoLabel>
              <MonoLabel className="text-ember">142 BPM · A♭M</MonoLabel>
            </div>
            <Waveform seed={3.1} bars={56} color="var(--ember)" height={64} />
            <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>0:00</span>
              <span className="truncate text-foreground">
                ▶ NORTHERN ROOM / v04 — pending merge
              </span>
              <span>3:18</span>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <GhostButton variant="ember" href={signInHref}>+ Start a band</GhostButton>
          <GhostButton variant="outline" href={signInHref}>Join with invite code →</GhostButton>
          <GhostButton variant="ghost" href={signInHref}>For studios &amp; labels</GhostButton>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-4">
          {[
            ["1 PLACE", "files · chords · notes"],
            ["∞ BRANCHES", "experiment without fear"],
            ["ASYNC", "different cities, same track"],
            ["EXPLICIT", "decisions instead of chaos"],
          ].map(([k, v]) => (
            <div key={k} className="bg-background p-5">
              <div
                className="font-bold tracking-tight text-foreground text-2xl"
                style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
              >
                {k}
              </div>
              <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {v}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

/* ============================================================
 * Marquee
 * ============================================================ */

function Marquee() {
  const items = [
    "BRANCHES", "MERGES", "STRUCTURE", "CHORDS", "ROADMAP", "CHECKLIST",
    "QUICK PEEK", "REHEARSAL VIEW", "MIDI", "COMMENTS", "CHAT", "VERSIONS",
  ];
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-y border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] py-4">
      <div className="tb-marquee flex whitespace-nowrap">
        {row.map((it, i) => (
          <span
            key={i}
            className="mx-8 inline-flex items-center gap-3 font-mono-tb text-[11px] uppercase tracking-[0.3em] text-muted-foreground"
          >
            <span className="size-1 bg-ember" />
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * Philosophy
 * ============================================================ */

function Philosophy() {
  const pillars = [
    {
      n: "01",
      t: "Context over files",
      d: "A track isn't audio alone. Structure, chords, lyrics, comments anchored to seconds — they all live in one room.",
    },
    {
      n: "02",
      t: "Async by design",
      d: "One records at midnight. Another listens at breakfast. Nothing requires you to be online at the same time.",
    },
    {
      n: "03",
      t: "Conflict is a choice",
      d: "Two solos? Two arrangements? That's not a problem to hide — it's a decision to make. TrackBase makes it visible.",
    },
  ];
  return (
    <section className="relative border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="00"
        kicker="PHILOSOPHY"
        title="THREE THINGS"
        accent="WE BELIEVE."
        description="The product is the consequence of three convictions about how music actually gets made between humans."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-3">
        {pillars.map((p, i) => (
          <motion.div
            key={p.n}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="group relative bg-background p-8 transition-colors hover:bg-card"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-mono-tb text-xs uppercase tracking-[0.22em] text-ember">{p.n}</span>
              <span className="size-2 bg-ember tb-blink" />
            </div>
            <h3
              className="font-bold leading-tight tracking-tight text-2xl md:text-3xl"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              {p.t}
            </h3>
            <p className="mt-4 font-mono-tb text-sm leading-relaxed text-muted-foreground">{p.d}</p>
            <div className="mt-8 h-px w-full bg-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--ember)_60%,transparent)]" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
 * Branch / version showcase
 * ============================================================ */

function BranchShowcase() {
  const branches = [
    { name: "main", color: "var(--ember)", date: "JUN 11", note: "live · 4 tracks · 2:59" },
    { name: "alt-bridge", color: "var(--wave-violet)", date: "JUN 12", note: "experiment · solo rewrite" },
    { name: "darker-mix", color: "var(--wave-coral)", date: "JUN 14", note: "ready for review" },
    { name: "new", color: "var(--wave-mint)", date: "JUN 14", note: "draft" },
  ];
  return (
    <section id="mixer" className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="01"
        kicker="VERSIONING"
        title="BRANCH IT."
        accent="MERGE IT. SHIP IT."
        description="Try the bolder bridge without breaking what already works. Every version is a real artifact with date, author and status — not another file called final_v3_FINAL.wav."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Version rail */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <MonoLabel>VERSION HISTORY</MonoLabel>
            <MonoLabel className="text-ember">4</MonoLabel>
          </div>
          <ul className="space-y-2">
            {branches.map((b, i) => (
              <motion.li
                key={b.name}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="group flex items-start gap-3 border border-transparent p-3 transition-colors hover:border-border hover:bg-background"
              >
                <span className="mt-1 size-2.5 shrink-0" style={{ background: b.color }} />
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm font-semibold text-foreground"
                    style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
                  >
                    {b.name}
                  </div>
                  <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {b.date} · {b.note}
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
          <button className="mt-4 w-full border border-[color-mix(in_oklab,var(--ember)_60%,transparent)] px-3 py-2 text-left font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember transition-colors hover:bg-ember hover:text-primary-foreground">
            <span className="opacity-60">⌥</span> + NEW BRANCH
          </button>
        </div>

        {/* Mixer board */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] p-4 md:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <MonoLabel>PROJECT · NORTHERN ROOM</MonoLabel>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:ml-auto sm:mx-0 sm:overflow-visible sm:px-0">
              {["MAIN", "ALT-BRIDGE", "DARKER-MIX", "NEW"].map((t, i) => (
                <span
                  key={t}
                  className={`shrink-0 border px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] ${
                    i === 0
                      ? "border-ember bg-ember text-primary-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {i === 0 ? "● " : "✓ "}
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Structure ribbon */}
          <div className="mb-3 flex flex-col gap-2 border border-[color-mix(in_oklab,var(--ember)_30%,transparent)] bg-[color-mix(in_oklab,var(--ember)_5%,transparent)] p-2 sm:grid sm:grid-cols-[120px_1fr]">
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember">
              STRUCTURE
            </span>
            <div className="flex gap-[2px]">
              {[
                ["INTRO", 8, "var(--ember)"],
                ["VERSE", 16, "var(--ember-dim)"],
                ["PRE-CHORUS", 8, "var(--ember)"],
                ["CHORUS", 16, "var(--ember-dim)"],
                ["BRIDGE", 12, "var(--ember)"],
                ["CHORUS", 12, "var(--ember-dim)"],
              ].map(([n, w, c], i) => (
                <div
                  key={i}
                  className="flex h-7 items-center justify-center"
                  style={{ flexBasis: `${(w as number) * 1.4}%`, background: c as string }}
                >
                  <span className="truncate px-1 font-mono-tb text-[8px] uppercase tracking-[0.18em] text-primary-foreground sm:text-[9px] sm:tracking-[0.2em]">
                    {n as string}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Tracks */}
          {[
            { name: "GTR-RHYTHM", file: "northern 1-Audio.wav · 8.3 MB", color: "var(--wave-violet)", seed: 2.3 },
            { name: "DRUMS", file: "northern 2-Group.wav · 16.2 MB", color: "var(--wave-mint)", seed: 4.7 },
            { name: "BASS", file: "northern 3-Audio.wav · 5.5 MB", color: "var(--wave-amber)", seed: 6.1 },
            { name: "GTR-SOLO", file: "northern 4-Audio.wav · 7.3 MB", color: "var(--wave-coral)", seed: 8.4 },
          ].map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: i * 0.08 }}
              className="group grid grid-cols-1 items-center gap-2 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="grid size-7 place-items-center font-mono-tb text-[11px] font-bold text-primary-foreground"
                    style={{ background: t.color }}
                  >
                    {t.name[0]}
                  </span>
                  <div className="min-w-0">
                    <div
                      className="text-xs font-semibold tracking-tight"
                      style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
                    >
                      {t.name}
                    </div>
                    <div className="truncate font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                      {t.file}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1">
                  {["M", "S"].map((b) => (
                    <span
                      key={b}
                      className="grid size-5 place-items-center border border-border font-mono-tb text-[9px]"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <Waveform seed={t.seed} bars={48} color={t.color} height={56} />
            </motion.div>
          ))}

          <div className="mt-4 flex items-center justify-between border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center bg-ember text-primary-foreground">▶</span>
              <span className="font-mono-tb text-[11px] text-muted-foreground">0:00 / 2:59</span>
            </div>
            <div className="hidden gap-2 md:flex">
              {["METRO", "COUNT-IN", "LOOP", "COMMENT MODE"].map((b) => (
                <span
                  key={b}
                  className="border border-border px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Roadmap + Chat + Rehearsal
 * ============================================================ */

function ProcessShowcase() {
  return (
    <section className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02"
        kicker="WORKFLOW"
        title="ROADMAP, CHAT,"
        accent="DECISIONS — IN BAND."
        description="Stop pinning voice memos in Telegram and stop renaming Drive folders. Everything that decides a track lives where the track lives."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {/* Roadmap */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <MonoLabel>QUICK PEEK · ROADMAP</MonoLabel>
            <MonoLabel className="text-ember">2 / 3</MonoLabel>
          </div>
          <div className="space-y-4">
            {[
              { n: 1, label: "Write the song", state: "done" },
              { n: 2, label: "Tracking week", state: "now" },
              { n: 3, label: "Mix & master", state: "next" },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-3"
              >
                <span
                  className={`grid size-8 place-items-center font-mono-tb text-xs font-bold ${
                    s.state === "done"
                      ? "bg-ember text-primary-foreground"
                      : s.state === "now"
                        ? "border border-ember text-ember tb-blink"
                        : "border border-border text-muted-foreground"
                  }`}
                >
                  {s.state === "done" ? "✓" : s.n}
                </span>
                <div className="flex-1 border-b border-dashed border-[color-mix(in_oklab,var(--border)_60%,transparent)]" />
                <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {s.label}
                </span>
              </motion.div>
            ))}
          </div>
          <div className="mt-6 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-4 font-mono-tb text-[10px] uppercase tracking-[0.2em]">
            <span className="text-(--wave-amber)">● TRACKING</span>{" "}
            <span className="text-muted-foreground">— since 5d · holding steady.</span>
          </div>
        </div>

        {/* Chat */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <MonoLabel>CHAT · # NORTHERN-ROOM</MonoLabel>
            <MonoLabel className="text-ember">4 MEMBERS</MonoLabel>
          </div>
          <div className="space-y-4">
            {[
              {
                u: "MK",
                c: "var(--wave-sky)",
                t: "the bridge is finally landing. listen at 1:42",
                refs: [["BRANCH", "alt-bridge"], ["TRACK", "gtr-solo"]],
              },
              {
                u: "AV",
                c: "var(--ember)",
                t: "agree. let's keep the dry guitar, drop the reverb tail",
                refs: [["TRACK", "gtr-rhythm"]],
              },
              {
                u: "JL",
                c: "var(--wave-mint)",
                t: "merging into main tonight after tracking",
                refs: [["BRANCH", "main"]],
              },
            ].map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="flex gap-3"
              >
                <span
                  className="grid size-7 shrink-0 place-items-center font-mono-tb text-[10px] font-bold text-primary-foreground"
                  style={{ background: m.c }}
                >
                  {m.u}
                </span>
                <div className="flex-1">
                  <p className="font-mono-tb text-[12px] leading-relaxed text-foreground">{m.t}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.refs.map(([k, v]) => (
                      <span
                        key={v}
                        className="inline-flex items-center gap-1 border border-[color-mix(in_oklab,var(--ember)_40%,transparent)] bg-[color-mix(in_oklab,var(--ember)_5%,transparent)] px-2 py-0.5 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-ember"
                      >
                        <span className="opacity-60">{k === "BRANCH" ? "⎇" : "♪"}</span>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Rehearsal mobile */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <MonoLabel>REHEARSAL VIEW · MOBILE</MonoLabel>
            <MonoLabel className="text-ember">LIVE</MonoLabel>
          </div>
          <div className="mx-auto max-w-[260px] border-2 border-border bg-background p-3">
            <div className="mb-3 flex items-center justify-between">
              <MonoLabel className="text-ember">● REHEARSAL</MonoLabel>
              <MonoLabel>142 BPM · A♭M</MonoLabel>
            </div>
            <Waveform seed={5.6} bars={42} color="var(--ember)" height={70} />
            <div className="mt-3 grid grid-cols-3 gap-1">
              {["INTRO", "VERSE", "CHORUS"].map((s, i) => (
                <span
                  key={s}
                  className={`px-1 py-1 text-center font-mono-tb text-[9px] uppercase tracking-[0.18em] ${
                    i === 1
                      ? "bg-ember text-primary-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-3 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
              <span className="text-ember">VERSE</span> · Bb · Gm · Cm · Gm · Dm · Dm · Gm · Eb
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="grid size-8 place-items-center bg-ember text-primary-foreground">▶</span>
              <span className="font-mono-tb text-[10px] text-muted-foreground">METRO · LOOP</span>
            </div>
          </div>
          <p className="mt-4 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Open the phone at the rehearsal room. Full mix, structure, chords, click — no laptop, no DAW.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Persona cards
 * ============================================================ */

type Persona = {
  tag: string;
  title: string;
  who: string;
  reality: string;
  trackbase: string;
  metric: string;
  color: string;
};

function PersonaCard({ p, i }: { p: Persona; i: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ delay: i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="group relative flex flex-col border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-6 transition-colors hover:border-[color-mix(in_oklab,var(--ember)_60%,transparent)]"
    >
      <div className="mb-6 flex items-start justify-between">
        <span
          className="grid size-12 place-items-center font-bold text-lg text-primary-foreground"
          style={{
            background: p.color,
            fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)",
          }}
        >
          {p.tag.slice(0, 2)}
        </span>
        <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {p.tag}
        </span>
      </div>
      <h3
        className="font-bold leading-tight tracking-tight text-2xl"
        style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
      >
        {p.title}
      </h3>
      <p className="mt-2 font-mono-tb text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {p.who}
      </p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed">
        <p className="font-mono-tb text-[12px] text-muted-foreground line-through decoration-[color-mix(in_oklab,var(--ember)_60%,transparent)]">
          {p.reality}
        </p>
        <p className="font-mono-tb text-[12px] text-foreground">{p.trackbase}</p>
      </div>

      <div className="mt-auto pt-6">
        <div className="h-px w-full bg-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--ember)_60%,transparent)]" />
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember">
            {p.metric}
          </span>
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">→</span>
        </div>
      </div>
    </motion.article>
  );
}

function ForBands() {
  const personas: Persona[] = [
    {
      tag: "INDIE-BAND",
      title: "The indie band",
      who: "3–5 musicians · 18–35 · different DAWs",
      reality: "Demos scattered across Telegram. 'I thought you fixed that.' Chord disputes the night before recording.",
      trackbase: "One room with branches, comments on the bar, and a structure everybody opens at rehearsal.",
      metric: "01 · STAY IN SYNC",
      color: "var(--wave-violet)",
    },
    {
      tag: "HOME-PROD",
      title: "Solo producer + collab",
      who: "Producer · vocalist · different cities",
      reality: "Reuploading _v3_FINAL. Asking 'where do I drop the vocal?' Wondering which mix is the latest.",
      trackbase: "Give a collaborator a single link. They land on the right version, with full history and context.",
      metric: "02 · WORK ASYNC",
      color: "var(--ember)",
    },
    {
      tag: "MUSIC-STUDENT",
      title: "Music school student",
      who: "14–25 · works with teacher & classmates",
      reality: "Feedback only happens in the lesson. Iterations between weeks are invisible — and forgotten.",
      trackbase: "Teacher leaves comments on the exact second. Version history becomes a portfolio of progress.",
      metric: "03 · LEARN OUT LOUD",
      color: "var(--wave-mint)",
    },
    {
      tag: "COVER-BAND",
      title: "Cover / tribute band",
      who: "5–10 players · regular rehearsals",
      reality: "Everyone has chords in their own notebook. New player joins — onboarding eats the first session.",
      trackbase: "Structure with chords on every phone. New member is rehearsal-ready in an afternoon.",
      metric: "04 · ONBOARD FAST",
      color: "var(--wave-coral)",
    },
  ];
  return (
    <section id="bands" className="relative border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="03"
        kicker="FOR THE BAND"
        title="WHO IT'S FOR,"
        accent="ROOM BY ROOM."
        description="Built first for the people closest to the song — the ones writing it, arguing about it, and showing up to rehearsal on Tuesday night."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-2 xl:grid-cols-4">
        {personas.map((p, i) => <PersonaCard key={p.tag} p={p} i={i} />)}
      </div>
    </section>
  );
}

function ForStudios() {
  const personas: Persona[] = [
    {
      tag: "STUDIO",
      title: "Recording studio",
      who: "5–30 active artists · engineers · managers",
      reality: "Every artist has their own Drive. Engineers swap — and the project loses its memory.",
      trackbase: "One workspace per artist. Approval flow on the final mix. Notes attached to the second.",
      metric: "01 · SCALE WITHOUT CHAOS",
      color: "var(--wave-coral)",
    },
    {
      tag: "MUSIC-SCHOOL",
      title: "Music school / online platform",
      who: "50–500 students · teachers · cohorts",
      reality: "Teachers can't see the iterations between lessons. Group projects are organized in a chat.",
      trackbase: "Assignments live as projects. Teachers comment on moments. Activity is visible — and gradeable.",
      metric: "02 · BUILT INTO THE CURRICULUM",
      color: "var(--wave-mint)",
    },
    {
      tag: "LABEL",
      title: "Independent label / incubator",
      who: "5–20 artists · A&R · product managers",
      reality: "A&R can't see progress without a call. Artists deliver 'not quite' — there was no brief.",
      trackbase: "Roadmap per track. Review specific versions. Statistics per artist — without micromanagement.",
      metric: "03 · A&R WITHOUT THE CALLS",
      color: "var(--ember)",
    },
    {
      tag: "PROD-HOUSE",
      title: "Producer collective",
      who: "Multi-producer teams · shared roster",
      reality: "Tasks blur across producers. Versions mix between writers. Internal conflict about whose mix it is.",
      trackbase: "Roles and tasks inside the team. Parallel branches. Clean export & share for clients.",
      metric: "04 · LOOK PROFESSIONAL",
      color: "var(--wave-violet)",
    },
  ];
  return (
    <section id="studios" className="relative border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="04"
        kicker="FOR THE STUDIO"
        title="TEAMS THAT SHIP"
        accent="MUSIC AT VOLUME."
        description="Studios, schools and labels run dozens of projects in parallel. TrackBase gives them the surface to track every one — without becoming the bottleneck."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-2 xl:grid-cols-4">
        {personas.map((p, i) => <PersonaCard key={p.tag} p={p} i={i} />)}
      </div>
    </section>
  );
}

/* ============================================================
 * Feature index
 * ============================================================ */

function FeatureIndex() {
  type Item = { label: string; icon: ComponentType<{ size?: number; className?: string }> };
  const groups: Array<{ n: string; t: string; accent: string; items: Item[] }> = [
    {
      n: "05.1", t: "ORGANIZATION", accent: "var(--wave-violet)",
      items: [
        { label: "Bands & invite codes", icon: Users },
        { label: "Custom role tags · guitarist, vocalist, producer", icon: Tag },
        { label: "Real-time activity feed", icon: Activity },
        { label: "Group statistics — branches, merges, comments", icon: BarChart3 },
      ],
    },
    {
      n: "05.2", t: "VERSIONING", accent: "var(--ember)",
      items: [
        { label: "Branches for safe experiments", icon: GitBranch },
        { label: "Merge with conflict resolution", icon: GitMerge },
        { label: "Full version history · author, status, date", icon: History },
        { label: "Restore any version, any time", icon: Undo2 },
      ],
    },
    {
      n: "05.3", t: "MIXER", accent: "var(--wave-mint)",
      items: [
        { label: "Multi-track waveforms", icon: AudioWaveform },
        { label: "Mute · Solo · Offset · Replace", icon: Volume2 },
        { label: "Record straight into the project", icon: Mic },
        { label: "Metronome · count-in · loop section", icon: Timer },
        { label: "Range comments with threads", icon: MessageSquare },
      ],
    },
    {
      n: "05.4", t: "STRUCTURE & CHORDS", accent: "var(--wave-amber)",
      items: [
        { label: "Section editor over bars", icon: LayoutGrid },
        { label: "Chord-per-section · auto-detect", icon: Music2 },
        { label: "Structure overlay above waveforms", icon: Layers },
        { label: "Chord chart for rehearsal", icon: ListMusic },
      ],
    },
    {
      n: "05.5", t: "MIDI", accent: "var(--wave-sky)",
      items: [
        { label: "Built-in piano roll · draw & select", icon: Piano },
        { label: "GM instrument bank", icon: Boxes },
        { label: "Snap-to-grid · undo / redo", icon: MousePointer2 },
      ],
    },
    {
      n: "05.6", t: "RESOURCES", accent: "var(--wave-coral)",
      items: [
        { label: "Attach PDFs, DAW projects, anything", icon: Paperclip },
        { label: "External links", icon: Link2 },
        { label: "Lyrics editor", icon: FileText },
        { label: "Roadmap stages · current status", icon: Compass },
        { label: "Checklist with assignments", icon: CheckSquare },
      ],
    },
    {
      n: "05.7", t: "REHEARSAL VIEW · MOBILE", accent: "var(--ember-bright)",
      items: [
        { label: "Portrait · full mix + structure + chords", icon: Smartphone },
        { label: "Landscape · full mixer", icon: Maximize2 },
        { label: "Metronome & loop on the phone", icon: Repeat },
      ],
    },
    {
      n: "05.8", t: "EXPORT & SHARE", accent: "var(--wave-violet)",
      items: [
        { label: "WAV export", icon: FileAudio },
        { label: "Member-only project share links", icon: Share2 },
        { label: "Quick Peek — preview-mix from band page", icon: Eye },
        { label: "Per-project & per-band chat with @mentions, branch & track refs", icon: Hash },
      ],
    },
  ];

  return (
    <section id="system" className="border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="05"
        kicker="SYSTEM"
        title="THE FULL"
        accent="STUDIO SURFACE."
        description="From the first idea to the WAV export — TrackBase is one continuous environment. Nothing leaves the room."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-2 lg:grid-cols-4">
        {groups.map((g, gi) => (
          <motion.div
            key={g.t}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: gi * 0.05 }}
            whileHover={{ y: -2 }}
            className="group relative overflow-hidden bg-background p-6 transition-colors hover:bg-card"
          >
            <span
              className="absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
              style={{ background: g.accent }}
            />
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em]" style={{ color: g.accent }}>
                {g.n}
              </span>
              <span className="size-1.5 opacity-60 transition-opacity group-hover:opacity-100" style={{ background: g.accent }} />
            </div>
            <h3
              className="font-bold tracking-tight text-lg"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              {g.t}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {g.items.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="group/item flex items-start gap-2.5 font-mono-tb text-[11px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span
                    className="mt-[1px] grid size-5 shrink-0 place-items-center border border-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-all duration-200 group-hover/item:border-transparent"
                    style={{ color: g.accent }}
                  >
                    <Icon size={11} />
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
 * Rehearsal Mode deep-dive
 * ============================================================ */

function RehearsalDeepDive() {
  const scenarios = [
    {
      icon: KeyRound,
      kicker: "FORGOT THE CHANGES",
      title: "Chords on the second.",
      body: "Open the project, scroll to the bridge, the chord chart for that bar is already there. No more squinting at a printed sheet or interrupting the take to ask.",
    },
    {
      icon: Repeat,
      kicker: "PRACTICE THE HARD PART",
      title: "Loop any section.",
      body: "Tap a section, tap loop. The chorus runs on its own while you nail the run. Metronome locks to the project's BPM — no separate app, no laptop on the floor.",
    },
    {
      icon: Mic,
      kicker: "IDEA, NOW",
      title: "Capture before it leaves.",
      body: "A riff arrives between takes. Hit record. It lands in the project — versioned, timestamped, attached to the song it came from. Not buried in a voice-memo graveyard.",
    },
    {
      icon: Lightbulb,
      kicker: "ON THE SPOT",
      title: "Decide together, instantly.",
      body: "Drop a range comment on bar 32 from the rehearsal room. By soundcheck, the bassist has already replied — with an alt take pushed to a branch.",
    },
  ];

  return (
    <section className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02.5"
        kicker="REHEARSAL MODE"
        title="THE PHONE IS"
        accent="THE STUDIO."
        description="A mode built for the rehearsal room, the practice corner, and the back-of-the-tour-bus moment. No DAW, no cables, no excuses for losing the idea."
      />

      <div className="mt-12 grid gap-8 lg:grid-cols-[420px_1fr] lg:items-start">
        {/* Phone mock */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-[360px]"
        >
          <div className="relative border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <MonoLabel className="text-ember">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 bg-ember tb-blink" /> REHEARSAL
                </span>
              </MonoLabel>
              <MonoLabel>142 BPM · A♭M</MonoLabel>
            </div>

            <div className="border border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-[color-mix(in_oklab,var(--background)_60%,transparent)] p-3">
              <Waveform seed={7.3} bars={48} color="var(--ember)" height={84} />
              <div className="mt-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>0:42</span>
                <motion.span
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className="text-ember"
                >
                  ● LOOP · CHORUS
                </motion.span>
                <span>1:08</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1">
              {["INTRO", "VERSE", "CHORUS", "BRIDGE"].map((s, i) => (
                <motion.span
                  key={s}
                  whileHover={{ y: -2 }}
                  className={`cursor-pointer px-1 py-1.5 text-center font-mono-tb text-[9px] uppercase tracking-[0.18em] transition-colors ${
                    i === 2
                      ? "bg-ember text-primary-foreground"
                      : "border border-border text-muted-foreground hover:border-[color-mix(in_oklab,var(--ember)_60%,transparent)] hover:text-ember"
                  }`}
                >
                  {s}
                </motion.span>
              ))}
            </div>

            <div className="mt-3 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3">
              <div className="mb-1 font-mono-tb text-[9px] uppercase tracking-[0.22em] text-ember">CHORUS</div>
              <div className="flex flex-wrap gap-1.5">
                {["Bb", "Gm", "Eb", "F", "Bb", "Gm", "Cm", "F"].map((c, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 + i * 0.05 }}
                    className={`grid h-8 min-w-[34px] place-items-center border px-1.5 font-mono-tb text-[11px] font-bold ${
                      i === 2
                        ? "border-ember bg-[color-mix(in_oklab,var(--ember)_10%,transparent)] text-ember"
                        : "border-border text-foreground"
                    }`}
                  >
                    {c}
                  </motion.span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button className="flex items-center justify-center gap-1.5 bg-ember py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-(--ember-bright)">
                ▶ PLAY
              </button>
              <button className="flex items-center justify-center gap-1.5 border border-border py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:border-ember hover:text-ember">
                <Timer size={11} /> METRO
              </button>
              <motion.button
                whileTap={{ scale: 0.94 }}
                className="group/rec flex items-center justify-center gap-1.5 border border-(--wave-coral) py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-(--wave-coral) transition-colors hover:bg-(--wave-coral) hover:text-primary-foreground"
              >
                <motion.span
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="size-1.5 rounded-full bg-(--wave-coral) group-hover/rec:bg-primary-foreground"
                />
                REC
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Scenarios */}
        <div className="grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-2">
          {scenarios.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.kicker}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                whileHover={{ y: -3 }}
                className="group relative overflow-hidden bg-background p-6 transition-colors hover:bg-card"
              >
                <span className="absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-ember transition-transform duration-500 group-hover:scale-x-100" />
                <div className="mb-4 flex items-center justify-between">
                  <span className="grid size-10 place-items-center border border-[color-mix(in_oklab,var(--ember)_60%,transparent)] text-ember transition-colors duration-300 group-hover:border-ember group-hover:bg-ember group-hover:text-background">
                    <Icon size={18} />
                  </span>
                  <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {s.kicker}
                  </span>
                </div>
                <h3
                  className="font-bold leading-tight tracking-tight text-xl md:text-2xl"
                  style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
                >
                  {s.title}
                </h3>
                <p className="mt-3 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Theming — seven rooms
 * ============================================================ */

function ThemingSection() {
  const themes = [
    { id: "ember-dark",        name: "EMBER DARK",        sub: "Bone-black canvas, hot amber signal.",  bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "oklch(0.68 0.22 35)",  fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "ember-light",       name: "EMBER LIGHT",       sub: "Studio paper with ember fire.",         bg: "oklch(0.97 0 0)",        surface: "oklch(1 0 0)",           line: "oklch(0.85 0 0)",        accent: "oklch(0.62 0.22 32)",  fg: "oklch(0.16 0 0)",       mute: "oklch(0.42 0 0)" },
    { id: "blush-dark",        name: "BLUSH DARK",        sub: "Deep black, vivid blush accent.",       bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "oklch(0.72 0.20 350)", fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "blush-light",       name: "BLUSH LIGHT",       sub: "Clean white, rose-pink signature.",     bg: "oklch(0.97 0 0)",        surface: "oklch(1 0 0)",           line: "oklch(0.85 0 0)",        accent: "oklch(0.58 0.22 350)", fg: "oklch(0.16 0 0)",       mute: "oklch(0.42 0 0)" },
    { id: "studio-dark",       name: "STUDIO DARK",       sub: "Slate-blue night, cool teal signal.",   bg: "oklch(0.19 0.012 250)",  surface: "oklch(0.22 0.014 250)", line: "oklch(0.30 0.014 250)", accent: "oklch(0.74 0.13 200)", fg: "oklch(0.92 0.005 250)", mute: "oklch(0.66 0.012 250)" },
    { id: "studio-light",      name: "STUDIO LIGHT",      sub: "Warm daylight, muted indigo accent.",   bg: "oklch(0.985 0.003 80)",  surface: "oklch(1 0 0)",          line: "oklch(0.88 0.005 80)",  accent: "oklch(0.52 0.14 282)", fg: "oklch(0.22 0.01 260)",  mute: "oklch(0.46 0.01 260)" },
    { id: "studio-paper-dark", name: "STUDIO PAPER DARK", sub: "Warm amber dark, same indigo depth.",   bg: "oklch(0.17 0.014 80)",   surface: "oklch(0.20 0.016 80)",  line: "oklch(0.30 0.016 80)",  accent: "oklch(0.62 0.15 282)", fg: "oklch(0.92 0.008 80)",  mute: "oklch(0.62 0.012 80)" },
  ];

  const [active, setActive] = useState(0);

  return (
    <section id="themes" className="relative border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="05.5"
        kicker="THEMING"
        title="ONE STUDIO."
        accent="SEVEN ROOMS."
        description="Daylight or basement, brutalist or paper. Same tools, different lighting — switch the surface to the room you're in."
      />

      {/* Desktop expanding panels */}
      <div
        className="mt-12 hidden h-[460px] gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:flex"
        onMouseLeave={() => setActive(0)}
      >
        {themes.map((t, i) => {
          const isActive = active === i;
          return (
            <motion.button
              key={t.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              animate={{ flex: isActive ? 4.2 : 1 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="group relative flex h-full min-w-0 cursor-pointer flex-col justify-between overflow-hidden p-4 text-left outline-none"
              style={{ background: t.bg, color: t.fg }}
              aria-label={t.name}
            >
              <div className="flex items-start justify-between">
                <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em]" style={{ color: t.accent }}>
                  0{i + 1}
                </span>
                <span className="size-2" style={{ background: t.accent }} />
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {isActive ? (
                  <motion.div
                    key="exp"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.3, delay: 0.18 }}
                    className="flex flex-1 flex-col justify-between gap-4 pt-4"
                  >
                    <div className="border p-3" style={{ borderColor: t.line, background: t.surface }}>
                      <div className="mb-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-[0.2em]" style={{ color: t.mute }}>
                        <span>PROJECT · MAIN</span>
                        <span style={{ color: t.accent }}>142 BPM</span>
                      </div>
                      <Waveform seed={2.4 + i} bars={32} color={t.accent} height={56} />
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex gap-1">
                          <span className="px-2 py-1 font-mono-tb text-[8px] uppercase tracking-[0.18em]" style={{ background: t.accent, color: t.surface }}>
                            ▶ PLAY
                          </span>
                          <span className="border px-2 py-1 font-mono-tb text-[8px] uppercase tracking-[0.18em]" style={{ borderColor: t.accent, color: t.accent }}>
                            ● LOOP
                          </span>
                        </div>
                        <span className="font-mono-tb text-[8px] uppercase tracking-[0.2em]" style={{ color: t.mute }}>v04</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-px">
                      {["INTRO", "VERSE", "CHORUS", "BRIDGE"].map((s, si) => (
                        <span
                          key={s}
                          className="border px-1 py-1 text-center font-mono-tb text-[8px] uppercase tracking-[0.18em]"
                          style={{
                            borderColor: t.line,
                            background: si === 2 ? t.accent : "transparent",
                            color: si === 2 ? t.surface : t.mute,
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>

                    <div>
                      <div
                        className="text-lg font-bold tracking-tight"
                        style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
                      >
                        {t.name}
                      </div>
                      <div className="mt-1 font-mono-tb text-[10px] uppercase leading-relaxed tracking-[0.16em]" style={{ color: t.mute }}>
                        {t.sub}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="col"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-1 items-end pb-1"
                  >
                    <span
                      className="text-base font-bold uppercase tracking-tight"
                      style={{
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                        fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)",
                      }}
                    >
                      {t.name}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {/* Mobile accordion */}
      <div className="mt-10 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:hidden">
        {themes.map((t, i) => {
          const isActive = active === i;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(isActive ? -1 : i)}
              className="block w-full p-4 text-left"
              style={{ background: t.bg, color: t.fg }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="size-3 shrink-0" style={{ background: t.accent }} />
                  <span
                    className="truncate text-base font-bold tracking-tight"
                    style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
                  >
                    {t.name}
                  </span>
                </div>
                <span className="font-mono-tb text-[10px] uppercase tracking-[0.2em]" style={{ color: t.accent }}>
                  0{i + 1}
                </span>
              </div>
              <AnimatePresence initial={false}>
                {isActive && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 border p-3" style={{ borderColor: t.line, background: t.surface }}>
                      <div className="mb-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-[0.2em]" style={{ color: t.mute }}>
                        <span>PROJECT · MAIN</span>
                        <span style={{ color: t.accent }}>142 BPM</span>
                      </div>
                      <Waveform seed={2.4 + i} bars={28} color={t.accent} height={48} />
                    </div>
                    <p className="mt-3 font-mono-tb text-[10px] uppercase leading-relaxed tracking-[0.16em]" style={{ color: t.mute }}>
                      {t.sub}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>

      <p className="mt-8 max-w-2xl font-mono-tb text-[11px] uppercase leading-relaxed tracking-[0.18em] text-muted-foreground">
        Switch instantly · syncs across band · per-project overrides for cohorts & labels.
      </p>
    </section>
  );
}

/* ============================================================
 * Pricing
 * ============================================================ */

function Pricing({ signInHref = "/auth" }: { signInHref?: string }) {
  const tiers = [
    {
      tag: "SOLO",
      name: "Home base",
      price: "Free",
      sub: "/ forever, during beta",
      blurb: "For the bedroom producer and the duo trading stems across two cities.",
      cta: "Start free",
      featured: false,
      color: "var(--wave-mint)",
      features: [
        "Up to 3 active projects",
        "1 GB per project",
        "Unlimited branches & versions",
        "Mixer, structure, chords",
        "Mobile Rehearsal View",
        "WAV export",
      ],
    },
    {
      tag: "BAND",
      name: "Full band",
      price: "$12",
      sub: "/ member · month",
      blurb: "For the working band — rehearsals, road, releases. The default choice.",
      cta: "Bring the band",
      featured: true,
      color: "var(--ember)",
      features: [
        "Unlimited projects",
        "10 GB per project",
        "Branches, merges, version history",
        "MIDI · piano roll · GM bank",
        "Range comments & threads",
        "Chat with branch & track refs",
        "Roadmap, checklist, lyrics",
        "Priority Quick Peek rendering",
      ],
    },
    {
      tag: "BAND+",
      name: "Full band+",
      price: "$22",
      sub: "/ member · month",
      blurb: "For bands shipping releases — mastering hand-off, stems library, label-ready exports.",
      cta: "Go pro",
      featured: false,
      color: "var(--wave-amber)",
      features: [
        "Everything in Full band",
        "50 GB per project · cold storage",
        "Stems library across all projects",
        "Lossless WAV / FLAC / stems export",
        "Mastering hand-off & release notes",
        "Guest reviewer links with expiry",
        "Advanced roles per project",
        "Analytics: who listened, where it stalled",
      ],
    },
    {
      tag: "STUDIO",
      name: "Studio · school · label",
      price: "Custom",
      sub: "/ team plan",
      blurb: "For teams running dozens of artists, classes or releases in parallel.",
      cta: "Talk to us",
      featured: false,
      color: "var(--wave-violet)",
      features: [
        "Everything in Full band+",
        "Workspaces per artist / cohort",
        "Roles, permissions, approval flow",
        "Per-artist statistics & activity",
        "SSO · domain · custom invite",
        "Onboarding + dedicated contact",
        "SLA & extended storage",
      ],
    },
  ];

  return (
    <section id="pricing" className="relative border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="06"
        kicker="PRICING"
        title="ONE SURFACE."
        accent="FOUR ROOMS."
        description="Pricing scales with the room you're working in — not with how many seconds of audio you happened to upload this month."
      />

      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-2 xl:grid-cols-4">
        {tiers.map((t, i) => (
          <motion.article
            key={t.tag}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
            className={`group relative flex flex-col p-7 transition-colors ${
              t.featured ? "bg-card" : "bg-background hover:bg-card"
            }`}
          >
            {t.featured && (
              <div className="absolute -top-px left-0 right-0 h-[3px] bg-ember" />
            )}

            <div className="mb-4 flex items-center gap-2">
              <span className="size-2.5" style={{ background: t.color }} />
              <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {t.tag}
              </span>
            </div>

            <h3
              className="font-bold tracking-tight text-2xl text-foreground"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              {t.name}
            </h3>
            <p className="mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
              {t.blurb}
            </p>

            <div className="mt-6 flex items-baseline gap-2 border-y border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-5">
              <span
                className="font-bold tracking-tight text-5xl text-foreground"
                style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
              >
                {t.price}
              </span>
              <span className="font-mono-tb text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t.sub}
              </span>
            </div>

            <ul className="mt-6 space-y-2.5">
              {t.features.map((f, fi) => (
                <motion.li
                  key={f}
                  initial={{ opacity: 0, x: -6 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + fi * 0.04 }}
                  className="flex items-start gap-2.5 font-mono-tb text-[12px] leading-relaxed text-foreground"
                >
                  <span
                    className="mt-[2px] grid size-4 shrink-0 place-items-center"
                    style={{ background: t.color, color: "oklch(0.12 0.01 30)" }}
                  >
                    <Check size={10} strokeWidth={3} />
                  </span>
                  <span>{f}</span>
                </motion.li>
              ))}
            </ul>

            <div className="mt-auto pt-6">
              <a
                href={signInHref}
                className={`group/btn flex w-full items-center justify-between border px-4 py-3 font-mono-tb text-[11px] uppercase tracking-[0.22em] transition-all ${
                  t.featured
                    ? "border-ember bg-ember text-primary-foreground hover:bg-(--ember-bright)"
                    : "border-[color-mix(in_oklab,var(--foreground)_40%,transparent)] text-foreground hover:border-ember hover:text-ember"
                }`}
              >
                <span>{t.cta}</span>
                <motion.span className="inline-block" initial={false} whileHover={{ x: 4 }}>→</motion.span>
              </a>
              {t.featured && (
                <div className="mt-2 flex items-center gap-1.5 font-mono-tb text-[9px] uppercase tracking-[0.22em] text-ember">
                  <Sparkles size={10} /> MOST CHOSEN
                </div>
              )}
            </div>
          </motion.article>
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center font-mono-tb text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        All plans · WAV export · unlimited members · branches · Rehearsal View.
        No card required for the free tier.
      </p>
    </section>
  );
}

/* ============================================================
 * Final CTA
 * ============================================================ */

function CTA({ signInHref = "/auth" }: { signInHref?: string }) {
  return (
    <section id="join" className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-4 py-24 md:px-8 md:py-32 tb-grid-bg-landing">
      <div className="relative mx-auto max-w-5xl text-center">
        <EmberTag className="mx-auto">PRIVATE BETA · OPEN</EmberTag>
        <h2
          className="mt-8 font-bold leading-[0.9] tracking-[-0.03em]"
          style={{
            fontSize: "clamp(2.5rem, 8vw, 7rem)",
            fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)",
          }}
        >
          STOP RENAMING <br />
          <span className="text-ember">FINAL_V3_FINAL.</span>
        </h2>
        <p className="mx-auto mt-8 max-w-2xl font-mono-tb text-sm leading-relaxed text-muted-foreground md:text-base">
          Bring your band, your roster, your class. TrackBase is free during beta — every workspace
          ships with branches, a mixer, structure, chords, chat and the rehearsal view from day one.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <GhostButton variant="ember" href={signInHref}>+ Create my band</GhostButton>
          <GhostButton variant="outline" href={signInHref}>Talk to us (studios)</GhostButton>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-4">
          {[
            ["FREE", "during beta"],
            ["1 GB", "per project"],
            ["∞ MEMBERS", "per band"],
            ["WAV", "lossless export"],
          ].map(([k, v]) => (
            <div key={k} className="bg-background p-5">
              <div
                className="font-bold tracking-tight text-foreground text-2xl"
                style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
              >
                {k}
              </div>
              <div className="mt-1 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Footer
 * ============================================================ */

function Footer() {
  return (
    <footer className="px-4 py-10 md:px-8">
      <div className="grid gap-8 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] p-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div
            className="font-bold tracking-tight text-ember text-xl"
            style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
          >
            TRACKBASE<span className="text-foreground">.</span>
          </div>
          <p className="mt-3 max-w-sm font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Built for musicians, indexed for engineers. Version control for music.
          </p>
        </div>
        {[
          ["PRODUCT", ["Mixer", "Branches", "Rehearsal View", "Roadmap", "Chat"]],
          ["FOR", ["Bands", "Studios", "Schools", "Labels", "Producer centers"]],
          ["CO", ["About", "Brandbook v0.9", "UI Kit", "Changelog", "Contact"]],
        ].map(([t, items]) => (
          <div key={t as string}>
            <div className="mb-3 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember">
              {t as string}
            </div>
            <ul className="space-y-2">
              {(items as string[]).map((item) => (
                <li key={item} className="font-mono-tb text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  <a href="#">{item}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>
          <span className="text-(--signal)">● SYS OK</span> · 3 bands · 9 projects · 676.4 MB used
        </span>
        <span>
          TRACKBASE <span className="text-foreground">// v0.9</span> · © 2026
        </span>
      </div>
    </footer>
  );
}

/* ============================================================
 * Page root
 * ============================================================ */

export default function LandingPage({ signInHref = "/auth" }: { signInHref?: string }) {
  return (
    <div className="landing-page min-h-screen" data-theme="ember-dark">
      <main className="min-h-screen bg-background text-foreground">
        <TopBar signInHref={signInHref} />
        <Hero signInHref={signInHref} />
        <Marquee />
        <Philosophy />
        <BranchShowcase />
        <ProcessShowcase />
        <RehearsalDeepDive />
        <ForBands />
        <ForStudios />
        <FeatureIndex />
        <ThemingSection />
        <CTA signInHref={signInHref} />
        <Footer />
      </main>
    </div>
  );
}
