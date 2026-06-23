"use client";

import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  AnimatePresence,
} from "motion/react";
import { useEffect, useRef, useState, useCallback, Fragment, type ReactNode, type ComponentType, type ComponentProps } from "react";
import { UserAvatar } from "@/components/ui/avatar";
import { MetronomeIcon } from "@/components/design/TransportIcons";
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
 * Mobile scroll-center hover (touch devices)
 * ============================================================ */

function shouldUseScrollHover() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(
    "(max-width: 1023px), (hover: none), (pointer: coarse)",
  ).matches;
}

const scrollHoverRegistry = new Set<HTMLElement>();
let scrollHoverFrame = 0;
let scrollHoverTick = 0;
let scrollHoverListening = false;

function pickScrollHoverTarget() {
  if (!shouldUseScrollHover()) {
    scrollHoverRegistry.forEach((el) => el.removeAttribute("data-scroll-active"));
    return;
  }

  const viewCenter = window.innerHeight / 2;
  const band = Math.max(120, window.innerHeight * 0.38);
  let best: { el: HTMLElement; dist: number } | null = null;

  for (const el of scrollHoverRegistry) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 8 || rect.top >= window.innerHeight - 8) continue;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.abs(centerY - viewCenter);
    if (dist > band) continue;
    if (!best || dist < best.dist) best = { el, dist };
  }

  scrollHoverRegistry.forEach((el) => {
    if (el !== best?.el) el.removeAttribute("data-scroll-active");
  });
  if (best) best.el.setAttribute("data-scroll-active", "");
}

function scheduleScrollHover() {
  cancelAnimationFrame(scrollHoverFrame);
  scrollHoverFrame = requestAnimationFrame(pickScrollHoverTarget);
}

function ensureScrollHoverListeners() {
  if (scrollHoverListening) return;
  scrollHoverListening = true;

  scheduleScrollHover();
  window.addEventListener("scroll", scheduleScrollHover, { passive: true });
  document.addEventListener("scroll", scheduleScrollHover, { passive: true, capture: true });
  window.visualViewport?.addEventListener("scroll", scheduleScrollHover);
  window.visualViewport?.addEventListener("resize", scheduleScrollHover);
  window.addEventListener("resize", scheduleScrollHover);
  window.addEventListener("orientationchange", scheduleScrollHover);
  scrollHoverTick = window.setInterval(pickScrollHoverTarget, 80);

  const coarse = window.matchMedia("(max-width: 1023px), (hover: none), (pointer: coarse)");
  const onCoarseChange = () => {
    if (!coarse.matches) {
      scrollHoverRegistry.forEach((el) => el.removeAttribute("data-scroll-active"));
    }
    scheduleScrollHover();
  };
  coarse.addEventListener("change", onCoarseChange);
}

function registerScrollHoverElement(el: HTMLElement) {
  scrollHoverRegistry.add(el);
  ensureScrollHoverListeners();
  scheduleScrollHover();
  return () => {
    scrollHoverRegistry.delete(el);
    el.removeAttribute("data-scroll-active");
    scheduleScrollHover();
  };
}

function useScrollHoverTarget<T extends HTMLElement>() {
  const unregisterRef = useRef<(() => void) | null>(null);

  const ref = useCallback((el: T | null) => {
    unregisterRef.current?.();
    unregisterRef.current = null;
    if (el) unregisterRef.current = registerScrollHoverElement(el);
  }, []);

  useEffect(() => () => unregisterRef.current?.(), []);

  return ref;
}

type LandingHoverCardProps = {
  children: ReactNode;
  className?: string;
  lift?: number;
} & Omit<ComponentProps<typeof motion.div>, "children">;

function LandingHoverCard({
  children,
  className = "",
  lift = 0,
  ...motionProps
}: LandingHoverCardProps) {
  const ref = useScrollHoverTarget<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      className={`${className}${lift ? ` landing-hover-lift-${lift}` : ""}`}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}

type LandingHoverLiProps = {
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof motion.li>, "children">;

function LandingHoverLi({ children, className = "", ...motionProps }: LandingHoverLiProps) {
  const ref = useScrollHoverTarget<HTMLLIElement>();

  return (
    <motion.li ref={ref} className={className} {...motionProps}>
      {children}
    </motion.li>
  );
}

function LandingHoverItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useScrollHoverTarget<HTMLLIElement>();

  return (
    <li ref={ref} className={className}>
      {children}
    </li>
  );
}

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

function TopBar({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const authHref = isAuthenticated ? "/dashboard" : "/auth";
  const authLabel = isAuthenticated ? "DASHBOARD →" : "+ SIGN IN";
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
    <div className="landing-full-bleed sticky top-0 z-40 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_95%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-6 md:gap-10">
          <a href="#top" className="flex shrink-0 items-center gap-2 text-foreground">
            <span
              className="font-display-tb text-base font-bold tracking-tight text-ember sm:text-lg"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              TRACKBASE
            </span>
            <span className="hidden font-mono-tb text-[10px] text-muted-foreground sm:inline">
              // v0.1
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
            href={authHref}
            className="hidden items-center gap-2 bg-ember px-3 py-2 font-mono-tb text-[11px] uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-(--ember-bright) sm:inline-flex"
          >
            {authLabel}
          </a>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="group inline-flex items-center gap-2.5 py-1 md:hidden"
          >
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors group-hover:text-ember">
              {open ? "Close" : "Menu"}
            </span>
            <span className="relative flex h-3 w-5 flex-col justify-between" aria-hidden>
              <motion.span
                animate={{ rotate: open ? 45 : 0, y: open ? 6 : 0 }}
                className="block h-px w-full origin-left bg-ember transition-colors"
              />
              <motion.span
                animate={{ opacity: open ? 0 : 1, scaleX: open ? 0 : 1 }}
                className="block h-px w-3 self-end bg-muted-foreground transition-colors group-hover:bg-ember/70"
              />
              <motion.span
                animate={{ rotate: open ? -45 : 0, y: open ? -6 : 0 }}
                className="block h-px w-full origin-left bg-ember transition-colors"
              />
            </span>
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
                href={authHref}
                onClick={() => setOpen(false)}
                className="mt-3 mb-2 flex items-center justify-center gap-2 bg-ember px-4 py-3 font-mono-tb text-[11px] uppercase tracking-[0.22em] text-primary-foreground"
              >
                {authLabel}
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
    <section ref={ref} id="top" className="relative">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 bottom-0 left-1/2 z-0 w-screen -translate-x-1/2 tb-grid-bg-landing"
        />
        <div className="relative z-10">
          <div className="relative overflow-hidden">
            <motion.div style={{ y, opacity }} className="relative px-4 pt-16 pb-10 md:px-8 md:pt-24 md:pb-14">
        {!reduce && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--ember)_60%,transparent)] to-transparent"
            initial={{ y: -200 }}
            animate={{ y: 900 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
        )}

        <div className="relative mb-10 flex flex-wrap items-center gap-4">
          <EmberTag>PRIVATE BETA · OPEN · V0.1</EmberTag>
        </div>

        <h1
          className="relative font-display-tb font-bold leading-[0.88] tracking-[-0.04em] text-foreground"
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

        <div className="relative mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <p className="max-w-xl font-mono-tb text-[15px] leading-relaxed text-muted-foreground md:text-[1rem]">
            A track doesn't arrive finished. It moves through dozens of iterations, arguments,
            voice memos and renamed exports. TrackBase is the collaborative surface where bands
            think, branch and decide together — versioned, structured, indexed.
          </p>

          <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <MonoLabel>ACTIVE PROJECT · MAIN</MonoLabel>
              <MonoLabel className="text-ember">142 BPM · A#m</MonoLabel>
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

        <div className="relative mt-10">
          <GhostButton variant="ember" href={signInHref}>+ Start a band</GhostButton>
        </div>
          </motion.div>
        </div>

        <div className="relative mb-28 px-4 md:mb-36 md:px-8">
          <div className="grid w-full grid-cols-2 gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-4">
            {[
              ["1 PLACE", "files · chords · notes"],
              ["∞ BRANCHES", "experiment without fear"],
              ["ASYNC", "different cities, same track"],
              ["EXPLICIT", "decisions instead of chaos"],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 bg-background px-5 py-5 sm:px-6">
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
        </div>

        <Marquee />
        </div>
      </div>
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
    <div className="landing-full-bleed overflow-hidden border-y border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-background py-4">
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
    <section className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="00"
        kicker="PHILOSOPHY"
        title="THREE THINGS"
        accent="WE BELIEVE."
        description="The product is the consequence of three convictions about how music actually gets made between humans."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-3">
        {pillars.map((p, i) => (
          <LandingHoverCard
            key={p.n}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="group relative landing-hover-surface bg-background p-8 transition-colors hover:bg-card"
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
            <div className="landing-hover-divider mt-8 h-px w-full bg-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--ember)_60%,transparent)]" />
          </LandingHoverCard>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
 * Branch / version showcase
 * ============================================================ */

function landingSectionTimeRange(startBar: number, endBar: number, barDurationMs: number) {
  const fmt = (secs: number) => {
    const s = Math.floor(secs);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };
  const start = fmt((startBar * barDurationMs) / 1000);
  const end = fmt((endBar * barDurationMs) / 1000);
  return `${start}–${end}`;
}

function LandingMobileStructureStrip() {
  const bpm = 142;
  const barDurationMs = (60 / bpm) * 4 * 1000;
  const activeIdx = 1;
  const sections = [
    { label: "Intro", start: 0, end: 8 },
    { label: "Verse", start: 8, end: 24 },
    { label: "Chorus", start: 32, end: 48 },
    { label: "Bridge", start: 48, end: 60 },
  ];
  const active = sections[activeIdx];

  return (
    <div className="mb-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] py-2 sm:hidden">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Section</span>
        <span className="truncate font-mono text-[9px] tabular-nums text-ember">
          ● {active.label} · {landingSectionTimeRange(active.start, active.end, barDurationMs)}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 pb-1">
        {sections.map((s, i) => {
          const activePill = i === activeIdx;
          return (
            <div
              key={s.label}
              className={`min-w-0 border px-1.5 py-1.5 text-center text-[10px] uppercase tracking-widest sm:px-2 ${
                activePill
                  ? "border-ember bg-ember text-primary-foreground"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <div className="truncate font-bold">{s.label}</div>
              <div className="truncate font-mono text-[8px] tabular-nums opacity-80">
                {landingSectionTimeRange(s.start, s.end, barDurationMs)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LandingStructureStrip() {
  const totalBars = 72;
  const barGridStep = 4;
  const tp = (bar: number) => bar / totalBars;
  const sectionBorder = "1px solid color-mix(in oklab, var(--border) 85%, var(--ember) 15%)";
  const sections = [
    { label: "INTRO", start: 0, end: 8, chords: "Am · F · C · G" },
    { label: "VERSE", start: 8, end: 24, chords: "Am · F · C · G" },
    { label: "PRE-CHORUS", start: 24, end: 32, chords: "F · G · Am" },
    { label: "CHORUS", start: 32, end: 48, chords: "C · G · Am · F" },
    { label: "BRIDGE", start: 48, end: 60, chords: "Dm · Am · Em · G" },
    { label: "CHORUS", start: 60, end: 72, chords: "C · G · Am · F" },
  ];

  return (
    <>
      <LandingMobileStructureStrip />
      <div className="mb-3 hidden items-stretch border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:flex">
        {/* Label column — aligned with track rows below */}
        <div className="hidden w-[160px] shrink-0 flex-col border-r border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] sm:flex">
          <div
            className="flex flex-col justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3"
            style={{ height: 40 }}
          >
            <span className="pt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              CHANNEL
            </span>
            <span className="pb-1.5 font-mono text-[9px] font-normal normal-case tracking-normal text-foreground/60">
              {totalBars} bars · 4/4
            </span>
          </div>
          <div
            className="flex flex-col justify-center bg-ember-soft/40 px-3"
            style={{ height: 56 }}
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-ember">
              STRUCTURE
            </span>
          </div>
        </div>

        {/* Timeline — bar ruler + structure strip */}
        <div className="min-w-0 flex-1 bg-[color-mix(in_oklab,var(--card)_30%,transparent)]">
          <div
            className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
            style={{ height: 40 }}
          >
            {[0, 16, 32, 48, 64].map((bar) => (
              <span
                key={bar}
                className={`pointer-events-none absolute top-0.5 font-mono text-[9px] tabular-nums ${
                  bar % 16 === 0 ? "font-medium text-foreground" : "text-muted-foreground/80"
                }`}
                style={{ left: `${tp(bar) * 100}%`, paddingLeft: bar === 0 ? 2 : 4 }}
              >
                {bar + 1}
              </span>
            ))}
            {Array.from({ length: Math.ceil(totalBars / barGridStep) }, (_, idx) => {
              const bar = idx * barGridStep;
              const isTact = bar % 4 === 0;
              return (
                <div
                  key={`ruler-${bar}`}
                  className="pointer-events-none absolute bottom-0 w-px"
                  style={{
                    left: `${tp(bar) * 100}%`,
                    height: isTact ? 12 : 6,
                    background: isTact
                      ? "color-mix(in oklab, var(--foreground) 45%, transparent)"
                      : "var(--border)",
                  }}
                />
              );
            })}
          </div>

          <div className="relative overflow-hidden bg-ember-soft/40" style={{ height: 56 }}>
            {Array.from({ length: Math.ceil(totalBars / barGridStep) }, (_, idx) => {
              const bar = idx * barGridStep;
              const isTact = bar % 4 === 0;
              return (
                <div
                  key={`grid-${bar}`}
                  className="pointer-events-none absolute top-0 bottom-0 w-px"
                  style={{
                    left: `${tp(bar) * 100}%`,
                    background: isTact ? "var(--border)" : "color-mix(in oklab, var(--border) 55%, transparent)",
                    opacity: isTact ? 0.55 : 0.35,
                  }}
                />
              );
            })}

            {sections.map((s) => (
              <div
                key={`${s.label}-${s.start}`}
                className="absolute inset-y-0 flex flex-col items-start justify-start overflow-hidden px-2 pt-1.5"
                style={{
                  left: `${tp(s.start) * 100}%`,
                  width: `${(tp(s.end) - tp(s.start)) * 100}%`,
                  borderLeft: sectionBorder,
                  borderRight: sectionBorder,
                  background: "color-mix(in oklab, var(--ember) 12%, transparent)",
                }}
              >
                <span className="pointer-events-none w-full truncate text-[9px] font-bold uppercase tracking-widest leading-tight text-ember">
                  {s.label}
                </span>
                <span className="pointer-events-none mt-0.5 w-full truncate font-mono text-[9px] leading-tight text-foreground/75">
                  {s.chords}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function BranchShowcase() {
  const branches = [
    { name: "main", color: "var(--ember)", date: "JUN 11", note: "live · 4 tracks · 2:59" },
    { name: "alt-bridge", color: "var(--wave-violet)", date: "JUN 12", note: "experiment · solo rewrite" },
    { name: "darker-mix", color: "var(--wave-coral)", date: "JUN 14", note: "ready for review" },
    { name: "new", color: "var(--wave-mint)", date: "JUN 14", note: "draft" },
  ];
  return (
    <section id="mixer" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
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
              <LandingHoverLi
                key={b.name}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="group landing-hover-row flex items-start gap-3 border border-transparent p-3 transition-colors hover:border-border hover:bg-background"
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
              </LandingHoverLi>
            ))}
          </ul>
          <LandingHoverCard
            className="landing-hover-ember mt-4 w-full border border-[color-mix(in_oklab,var(--ember)_60%,transparent)] px-3 py-2 text-left font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember transition-colors hover:bg-ember hover:text-primary-foreground"
          >
            <span className="opacity-60">⌥</span> + NEW BRANCH
          </LandingHoverCard>
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

          <LandingStructureStrip />

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

function LandingRoadmapCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 7l3.5 3.5L12 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LandingRoadmapConnector({ filled }: { filled: boolean }) {
  return (
    <div className="h-px w-full bg-border" aria-hidden>
      <div className={`h-full bg-ember transition-all duration-300 ${filled ? "w-full" : "w-0"}`} />
    </div>
  );
}

function LandingRoadmapChevronLeft({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 2L5 7l4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LandingRoadmapChevronRight({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 2l4 5-4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LandingWorkflowCard({
  kicker,
  meta,
  badge,
  caption,
  children,
}: {
  kicker: string;
  meta?: string;
  badge?: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <LandingHoverCard
      lift={2}
      className="flex h-full flex-col landing-hover-surface landing-hover-border-soft border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5 transition-colors hover:border-[color-mix(in_oklab,var(--ember)_40%,transparent)]"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MonoLabel>{kicker}</MonoLabel>
          {meta && (
            <span className="whitespace-nowrap font-mono-tb text-[10px] uppercase tracking-widest text-muted-foreground">
              {meta}
            </span>
          )}
        </div>
        {badge && <MonoLabel className="shrink-0 text-ember">{badge}</MonoLabel>}
      </header>

      <div className="flex flex-1 flex-col justify-center">{children}</div>

      <p className="mt-4 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">{caption}</p>
    </LandingHoverCard>
  );
}

function LandingRoadmapMock() {
  const steps = [
    { name: "Write the song" },
    { name: "Tracking week" },
    { name: "Mix & master" },
  ];
  const completedCount = 1;
  const current = steps[1];

  return (
    <LandingWorkflowCard
      kicker="QUICK PEEK · ROADMAP"
      meta="STAGE 2 / 3"
      caption="Custom stages per song — the whole band sees what's done, what's now, and what's next."
    >
      <div className="mx-auto w-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-background">
        <header className="flex items-center justify-end gap-1 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-2.5">
          <button
            type="button"
            aria-label="Move back one stage"
            className="grid size-7 place-items-center border border-border text-muted-foreground transition hover:border-ember hover:text-ember"
          >
            <LandingRoadmapChevronLeft />
          </button>
          <button
            type="button"
            aria-label="Advance to next stage"
            className="inline-flex h-7 items-center gap-1 border border-ember bg-ember px-2.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground transition hover:brightness-110"
          >
            Advance <LandingRoadmapChevronRight />
          </button>
        </header>

        <div className="flex w-full items-start px-4 py-5">
          {steps.map((step, i) => {
            const state =
              i < completedCount ? "done" : i === completedCount ? "current" : "ahead";
            return (
              <Fragment key={step.name}>
                {i > 0 && (
                  <div className="mt-3.5 min-w-[4px] flex-1 self-start">
                    <LandingRoadmapConnector filled={i <= completedCount} />
                  </div>
                )}
                <div className="flex w-[4.5rem] shrink-0 flex-col items-center">
                  <div
                    className={`relative z-10 grid size-7 place-items-center border text-[10px] font-bold ${
                      state === "done"
                        ? "border-ember bg-ember text-primary-foreground"
                        : state === "current"
                          ? "border-ember bg-background text-ember ring-2 ring-ember/30"
                          : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {state === "done" ? <LandingRoadmapCheck size={12} /> : i + 1}
                  </div>
                  <span
                    className={`mt-2 line-clamp-3 w-full break-words px-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wide ${
                      state === "ahead" ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {step.name.toUpperCase()}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-2.5 text-[10px] uppercase tracking-widest">
          <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-chart-4" aria-hidden />
            {current.name}
          </span>
          <span className="ml-auto text-chart-4">Since 5d ago · Holding steady.</span>
        </footer>
      </div>
    </LandingWorkflowCard>
  );
}

function LandingChatBranchIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.8v4.4M5.8 4H8a2 2 0 0 1 2 2v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function LandingChatNoteIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 12V4l7-1.5v8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="4.3" cy="12" rx="1.7" ry="1.4" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="11.3" cy="10.5" rx="1.7" ry="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function LandingChatClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function LandingChatLinkBadge({
  branch,
  track,
  time,
}: {
  branch?: string;
  track?: string;
  time?: string;
}) {
  const showTrack = !!track;
  const showTime = !!time;

  return (
    <div className="mt-1 inline-flex max-w-full items-stretch overflow-hidden border border-border bg-[color-mix(in_oklab,var(--card)_40%,transparent)] font-mono text-[10px]">
      {branch && (
        <span
          className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5${
            showTrack || showTime ? " border-r border-border" : ""
          }`}
        >
          <span className="text-ember">
            <LandingChatBranchIcon />
          </span>
          <span className="max-w-[4.5rem] truncate">{branch}</span>
        </span>
      )}
      {track && (
        <span
          className={`inline-flex max-w-[9rem] shrink-0 items-center gap-1 overflow-hidden px-1.5 py-0.5${
            showTime ? " border-r border-border" : ""
          }`}
        >
          <span className="shrink-0">
            <LandingChatNoteIcon />
          </span>
          <span className="truncate">{track}</span>
        </span>
      )}
      {time && (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 py-0.5 tabular-nums text-muted-foreground">
          <span className="shrink-0">
            <LandingChatClockIcon />
          </span>
          <span>{time}</span>
        </span>
      )}
    </div>
  );
}

function LandingChatMention({ children }: { children: ReactNode }) {
  return (
    <span className="bg-ember-soft/50 px-0.5 font-bold text-ember">{children}</span>
  );
}

function LandingChatChannelTab({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  return (
    <div className="relative flex h-10 w-full flex-col justify-center border-b-2 border-ember bg-ember-soft/40 px-3 text-left">
      <div className="text-[10px] font-bold uppercase leading-none tracking-widest text-ember">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-widest text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}

function LandingChatMock() {
  const messages: Array<{
    user: string;
    time: string;
    body: ReactNode;
    branch?: string;
    track?: string;
    timecode?: string;
  }> = [
    {
      user: "marek",
      time: "21:14",
      body: <>the bridge is finally landing. listen at 1:42</>,
      branch: "alt-bridge",
      track: "gtr-solo",
      timecode: "1:42",
    },
    {
      user: "ava",
      time: "21:18",
      body: (
        <>
          <LandingChatMention>@marek</LandingChatMention>
          {" agree — keep the dry guitar, drop the reverb tail"}
        </>
      ),
      track: "gtr-rhythm",
    },
    {
      user: "jules",
      time: "21:22",
      body: <>merging into main tonight after tracking</>,
      branch: "main",
    },
  ];

  return (
    <LandingWorkflowCard
      kicker="CHAT"
      caption="Project chat with @mentions, branch links, track refs, and timecodes — decisions stay where the song lives."
    >
      <div className="mx-auto w-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-background">
        <div className="bg-background">
          <LandingChatChannelTab label="# northern-room" hint="4 members · 12M" />
        </div>
        <div className="space-y-3 p-4">
          {messages.map((m, i) => (
            <motion.div
              key={m.user}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="flex gap-2.5"
            >
              <UserAvatar seed={m.user} size={28} kind="user" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-[10px] leading-none">
                  <span className="font-bold text-ember">@{m.user}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{m.time}</span>
                </div>
                <div className="mt-1 text-[12px] leading-relaxed text-foreground">{m.body}</div>
                {(m.branch || m.track || m.timecode) && (
                  <LandingChatLinkBadge branch={m.branch} track={m.track} time={m.timecode} />
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </LandingWorkflowCard>
  );
}

function LandingMobilePlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

function LandingMobileLoopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function LandingMobileTransportBtn({
  label,
  children,
  active = false,
  size = "sm",
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "size-10" : "size-9";
  return (
    <button
      type="button"
      aria-label={label}
      className={`${dim} mx-auto grid place-items-center border transition active:scale-95 ${
        active
          ? "border-ember bg-ember text-white"
          : "border-border text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function LandingRehearsalMock() {
  const sections = [
    { label: "INTRO", chords: "Bb · G · F", time: "0:00" },
    { label: "VERSE", chords: "Bb · Gm · Cm · Gm", time: "0:12" },
    { label: "CHORUS", chords: "Eb · F · Bb · Gm", time: "0:42" },
  ];

  return (
    <LandingWorkflowCard
      kicker="REHEARSAL VIEW · MOBILE"
      badge="LIVE"
      caption="Open the phone at the rehearsal room. Full mix, structure, chords, click — no laptop, no DAW."
    >
      <div className="mx-auto w-full max-w-[320px] border-2 border-border bg-background">
        <div className="p-3">
          <div className="mb-3 flex items-center justify-between">
            <MonoLabel className="text-ember">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 bg-ember tb-blink" /> REHEARSAL
              </span>
            </MonoLabel>
            <MonoLabel>142 BPM · A#m</MonoLabel>
          </div>
          <Waveform seed={5.6} bars={42} color="var(--ember)" height={70} />
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
            <span>0:12</span>
            <span>2:59</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1">
            {["INTRO", "VERSE", "CHORUS"].map((s, i) => (
              <span
                key={s}
                className={`px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest ${
                  i === 1
                    ? "border border-ember bg-ember text-white"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {s}
              </span>
            ))}
          </div>

          <div className="mt-3 border border-border divide-y divide-border">
            {sections.map((section) => (
              <div
                key={section.label}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
              >
                <div className="w-14 shrink-0 pt-0.5 text-[9px] font-bold uppercase tracking-widest text-ember">
                  {section.label}
                </div>
                <div className="min-w-0 flex-1 truncate text-left text-xs leading-relaxed text-foreground">
                  {section.chords}
                </div>
                <div className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {section.time}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border bg-[color-mix(in_oklab,var(--card)_30%,transparent)] px-3 pb-2.5 pt-1.5">
          <div className="grid grid-cols-3 items-center gap-1.5">
            <LandingMobileTransportBtn label="Metronome">
              <MetronomeIcon size={16} />
            </LandingMobileTransportBtn>
            <button
              type="button"
              aria-label="Play"
              className="mx-auto grid size-12 place-items-center bg-ember text-white transition hover:brightness-110 active:scale-95"
            >
              <LandingMobilePlayIcon />
            </button>
            <LandingMobileTransportBtn label="Loop section" active>
              <LandingMobileLoopIcon />
            </LandingMobileTransportBtn>
          </div>
        </div>
      </div>
    </LandingWorkflowCard>
  );
}

function ProcessShowcase() {
  return (
    <section className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02"
        kicker="WORKFLOW"
        title="ROADMAP, CHAT,"
        accent="DECISIONS — IN BAND."
        description="Stop pinning voice memos in Telegram and stop renaming Drive folders. Everything that decides a track lives where the track lives."
      />

      <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
        <LandingRoadmapMock />

        <LandingChatMock />

        <LandingRehearsalMock />
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
    <LandingHoverCard
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ delay: i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="group relative landing-hover-border flex flex-col border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-6 transition-colors hover:border-[color-mix(in_oklab,var(--ember)_60%,transparent)]"
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
        <div className="landing-hover-divider h-px w-full bg-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--ember)_60%,transparent)]" />
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-ember">
            {p.metric}
          </span>
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">→</span>
        </div>
      </div>
    </LandingHoverCard>
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
    <section id="bands" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
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
    <section id="studios" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
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
    <section id="system" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="05"
        kicker="SYSTEM"
        title="THE FULL"
        accent="STUDIO SURFACE."
        description="From the first idea to the WAV export — TrackBase is one continuous environment. Nothing leaves the room."
      />
      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:grid-cols-2 lg:grid-cols-4">
        {groups.map((g, gi) => (
          <LandingHoverCard
            key={g.t}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: gi * 0.05 }}
            lift={2}
            className="group relative landing-hover-surface overflow-hidden bg-background p-6 transition-colors hover:bg-card"
          >
            <span
              className="landing-hover-bar absolute inset-x-0 top-0 h-[2px] transition-transform duration-500"
              style={{ background: g.accent }}
            />
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em]" style={{ color: g.accent }}>
                {g.n}
              </span>
              <span className="landing-hover-dot size-1.5 opacity-60 transition-opacity group-hover:opacity-100" style={{ background: g.accent }} />
            </div>
            <h3
              className="font-bold tracking-tight text-lg"
              style={{ fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)" }}
            >
              {g.t}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {g.items.map(({ label, icon: Icon }) => (
                <LandingHoverItem
                  key={label}
                  className="group/item landing-hover-item-text flex items-start gap-2.5 font-mono-tb text-[11px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span
                    className="landing-hover-item-icon mt-[1px] grid size-5 shrink-0 place-items-center border border-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-all duration-200 group-hover/item:border-transparent"
                    style={{ color: g.accent }}
                  >
                    <Icon size={11} />
                  </span>
                  <span>{label}</span>
                </LandingHoverItem>
              ))}
            </ul>
          </LandingHoverCard>
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
      kicker: "A#m",
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
    <section className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02.5"
        kicker="REHEARSAL MODE"
        title="THE PHONE IS"
        accent="THE STUDIO."
        description="A mode built for the rehearsal room, the practice corner, and the back-of-the-tour-bus moment. No DAW, no cables, no excuses for losing the idea."
      />

      <div className="mt-12 grid gap-8 lg:grid-cols-[420px_1fr] lg:items-stretch">
        {/* Phone mock */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto h-full w-full max-w-[360px] lg:mx-0 lg:max-w-none"
        >
          <div className="relative flex h-full flex-col border border-border bg-card p-4">
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <MonoLabel className="text-ember">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 bg-ember tb-blink" /> REHEARSAL
                </span>
              </MonoLabel>
              <MonoLabel>142 BPM · A#m</MonoLabel>
            </div>

            <div className="flex shrink-0 flex-col border border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-[color-mix(in_oklab,var(--background)_60%,transparent)] p-3">
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

            <div className="mt-3 grid shrink-0 grid-cols-4 gap-1">
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

            <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3">
              <div className="mb-1 shrink-0 font-mono-tb text-[9px] uppercase tracking-[0.22em] text-ember">CHORUS</div>
              <div className="flex flex-1 flex-wrap content-start gap-1.5">
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

            <div className="mt-3 grid shrink-0 grid-cols-3 gap-1.5">
              <button className="flex items-center justify-center gap-1.5 bg-ember py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-primary-foreground transition-colors hover:bg-(--ember-bright)">
                ▶ PLAY
              </button>
              <button className="flex items-center justify-center gap-1.5 border border-border py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:border-ember hover:text-ember">
                <Timer size={11} /> METRO
              </button>
              <motion.button
                whileTap={{ scale: 0.94 }}
                className="group/rec flex items-center justify-center gap-1.5 border border-destructive py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                <motion.span
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="size-1.5 rounded-full bg-destructive group-hover/rec:bg-destructive-foreground"
                />
                REC
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Scenarios */}
        <div className="grid h-full gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-2">
          {scenarios.map((s, i) => {
            const Icon = s.icon;
            return (
              <LandingHoverCard
                key={s.kicker}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                lift={3}
                className="group relative landing-hover-surface h-full overflow-hidden bg-background p-6 transition-colors hover:bg-card"
              >
                <span className="landing-hover-bar absolute inset-x-0 top-0 h-[2px] bg-ember transition-transform duration-500" />
                <div className="mb-4 flex items-center justify-between">
                  <span className="landing-hover-icon grid size-10 place-items-center border border-[color-mix(in_oklab,var(--ember)_60%,transparent)] text-ember transition-[color,background-color,border-color] duration-300 group-hover:border-ember group-hover:bg-ember group-hover:!text-primary-foreground">
                    <Icon size={18} className="transition-colors duration-300" />
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
              </LandingHoverCard>
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

const THEME_REHEARSAL_SECTIONS = [
  { label: "INTRO", chords: "Bb · G · F", time: "0:00" },
  { label: "VERSE", chords: "Bb · Gm · Cm · Gm", time: "0:12" },
  { label: "CHORUS", chords: "Eb · F · Bb · Gm", time: "0:42" },
  { label: "BRIDGE", chords: "Gm · Eb · F · Bb", time: "1:08" },
] as const;

type ThemeTokens = {
  id: string;
  name: string;
  sub: string;
  bg: string;
  surface: string;
  line: string;
  accent: string;
  fg: string;
  mute: string;
};

const THEME_PREVIEW_BRANCHES = [
  { name: "main", kind: "main" as const, active: true },
  { name: "alt-bridge", kind: "branch" as const, active: false },
  { name: "darker-mix", kind: "merged" as const, active: false },
];

function ThemeBranchBar({ t }: { t: ThemeTokens }) {
  return (
    <div
      className="flex h-8 shrink-0 items-stretch overflow-hidden border"
      style={{
        borderColor: t.line,
        background: `color-mix(in oklab, ${t.fg} 5%, ${t.bg})`,
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 scrollbar-none">
        {THEME_PREVIEW_BRANCHES.map((b) => (
          <span
            key={b.name}
            className="shrink-0 border px-1.5 py-0.5 font-mono-tb text-[8px] uppercase tracking-[0.16em]"
            style={{
              borderColor: b.active ? t.accent : t.line,
              background: b.active ? t.accent : "transparent",
              color: b.active ? t.surface : t.mute,
              opacity: b.kind === "merged" && !b.active ? 0.55 : 1,
            }}
          >
            {b.active && b.kind === "main" && "● "}
            {b.kind === "merged" && "✓ "}
            {b.kind === "branch" && !b.active && "⌥ "}
            {b.name}
          </span>
        ))}
      </div>
      <span
        className="flex shrink-0 items-center border-l px-2 font-mono-tb text-[8px] uppercase tracking-[0.16em]"
        style={{ borderColor: t.line, color: t.mute }}
      >
        + Branch
      </span>
      <span
        className="grid w-8 shrink-0 place-items-center border-l"
        style={{ borderColor: t.line, color: t.mute }}
        aria-hidden
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 3.5h11a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H9.2L7 13.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

function ThemeRehearsalPreview({
  t,
  seed,
  waveformHeight = 56,
  activeSection = 2,
}: {
  t: ThemeTokens;
  seed: number;
  waveformHeight?: number;
  activeSection?: number;
}) {
  return (
    <>
      <div className="border p-3" style={{ borderColor: t.line, background: t.surface }}>
        <div
          className="mb-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-[0.2em]"
          style={{ color: t.mute }}
        >
          <span>PROJECT · MAIN</span>
          <span style={{ color: t.accent }}>142 BPM · A#m</span>
        </div>
        <Waveform seed={seed} bars={32} color={t.accent} height={waveformHeight} />
        <div className="mt-2 flex items-center justify-between font-mono-tb text-[8px] uppercase tracking-[0.18em]" style={{ color: t.mute }}>
          <span>0:42</span>
          <span style={{ color: t.accent }}>● LOOP · CHORUS</span>
          <span>1:08</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            <span
              className="px-2 py-1 font-mono-tb text-[8px] uppercase tracking-[0.18em]"
              style={{ background: t.accent, color: t.surface }}
            >
              ▶ PLAY
            </span>
            <span
              className="inline-flex items-center gap-1 border px-2 py-1 font-mono-tb text-[8px] uppercase tracking-[0.18em]"
              style={{ borderColor: t.accent, color: t.accent }}
            >
              <LandingMobileLoopIcon size={10} />
              LOOP
            </span>
          </div>
          <span className="font-mono-tb text-[8px] uppercase tracking-[0.2em]" style={{ color: t.mute }}>
            v04
          </span>
        </div>
      </div>

      <ThemeBranchBar t={t} />

      <div className="border" style={{ borderColor: t.line, background: t.surface }}>
        {THEME_REHEARSAL_SECTIONS.map((section, si) => (
          <div
            key={section.label}
            className="flex items-start gap-2 px-2 py-1.5 text-left"
            style={{
              borderTop: si > 0 ? `1px solid ${t.line}` : undefined,
              background:
                si === activeSection
                  ? `color-mix(in oklab, ${t.accent} 14%, ${t.surface})`
                  : t.surface,
            }}
          >
            <span
              className="w-12 shrink-0 pt-px font-mono-tb text-[8px] font-bold uppercase tracking-[0.16em]"
              style={{ color: si === activeSection ? t.accent : t.mute }}
            >
              {section.label}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono-tb text-[9px] leading-relaxed tracking-[0.04em]"
              style={{ color: t.fg }}
            >
              {section.chords}
            </span>
            <span
              className="shrink-0 pt-px font-mono-tb text-[8px] tabular-nums tracking-[0.08em]"
              style={{ color: t.mute }}
            >
              {section.time}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ThemingSection() {
  const themes: ThemeTokens[] = [
    { id: "ember-dark",        name: "EMBER DARK",        sub: "Bone-black canvas, hot amber signal.",  bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "oklch(0.68 0.22 35)",  fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "ember-light",       name: "EMBER LIGHT",       sub: "Studio paper with ember fire.",         bg: "oklch(0.97 0 0)",        surface: "oklch(1 0 0)",           line: "oklch(0.85 0 0)",        accent: "oklch(0.62 0.22 32)",  fg: "oklch(0.16 0 0)",       mute: "oklch(0.42 0 0)" },
    { id: "blush-dark",        name: "BLUSH DARK",        sub: "Deep black, vivid blush accent.",       bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "oklch(0.72 0.20 350)", fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "blush-light",       name: "BLUSH LIGHT",       sub: "Clean white, rose-pink signature.",     bg: "oklch(0.97 0 0)",        surface: "oklch(1 0 0)",           line: "oklch(0.85 0 0)",        accent: "oklch(0.58 0.22 350)", fg: "oklch(0.16 0 0)",       mute: "oklch(0.42 0 0)" },
    { id: "studio-dark",       name: "STUDIO DARK",       sub: "Slate-blue night, cool teal signal.",   bg: "oklch(0.19 0.012 250)",  surface: "oklch(0.22 0.014 250)", line: "oklch(0.30 0.014 250)", accent: "oklch(0.74 0.13 200)", fg: "oklch(0.92 0.005 250)", mute: "oklch(0.66 0.012 250)" },
    { id: "studio-light",      name: "STUDIO LIGHT",      sub: "Warm daylight, muted indigo accent.",   bg: "oklch(0.985 0.003 80)",  surface: "oklch(1 0 0)",          line: "oklch(0.88 0.005 80)",  accent: "oklch(0.52 0.14 282)", fg: "oklch(0.22 0.01 260)",  mute: "oklch(0.46 0.01 260)" },
    { id: "studio-paper-dark", name: "STUDIO PAPER DARK", sub: "Warm amber dark, same indigo depth.",   bg: "oklch(0.17 0.014 80)",   surface: "oklch(0.20 0.016 80)",  line: "oklch(0.30 0.016 80)",  accent: "oklch(0.62 0.15 282)", fg: "oklch(0.92 0.008 80)",  mute: "oklch(0.62 0.012 80)" },
  ];

  const [desktopActive, setDesktopActive] = useState(0);
  const [mobileThemeOpen, setMobileThemeOpen] = useState<number | null>(0);

  return (
    <section id="themes" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="05.5"
        kicker="THEMING"
        title="ONE STUDIO."
        accent="SEVEN ROOMS."
        description="Daylight or basement, brutalist or paper. Same tools, different lighting — switch the surface to the room you're in."
      />

      {/* Desktop expanding panels */}
      <div
        className="mt-12 hidden h-[540px] gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:flex"
        onMouseLeave={() => setDesktopActive(0)}
      >
        {themes.map((t, i) => {
          const isActive = desktopActive === i;
          return (
            <motion.div
              key={t.id}
              onMouseEnter={() => setDesktopActive(i)}
              animate={{ flex: isActive ? 4.2 : 1 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="group relative flex h-full min-w-0 cursor-default flex-col justify-between overflow-hidden p-4 text-left"
              style={{ background: t.bg, color: t.fg }}
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
                    className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden pt-4"
                  >
                    <ThemeRehearsalPreview t={t} seed={2.4 + i} waveformHeight={48} />

                    <div className="mt-auto shrink-0">
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
                      className="text-[1rem] font-bold uppercase tracking-tight"
                      style={{
                        color: t.fg,
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
            </motion.div>
          );
        })}
      </div>

      {/* Mobile — tap accordion */}
      <div className="mt-10 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] md:hidden">
        {themes.map((t, i) => {
          const isOpen = mobileThemeOpen === i;
          return (
            <div
              key={t.id}
              className="overflow-hidden"
              style={{ background: t.bg, color: t.fg }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setMobileThemeOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="size-3 shrink-0" style={{ background: t.accent }} />
                  <span
                    className="truncate text-[1rem] font-bold tracking-tight"
                    style={{
                      color: t.fg,
                      fontFamily: "var(--tb-font-display, 'Space Grotesk', system-ui, sans-serif)",
                    }}
                  >
                    {t.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono-tb text-[10px] uppercase tracking-[0.2em]" style={{ color: t.accent }}>
                    0{i + 1}
                  </span>
                  <span
                    className="grid size-6 place-items-center border font-mono-tb text-sm leading-none transition-transform duration-300"
                    style={{
                      borderColor: t.line,
                      color: isOpen ? t.surface : t.accent,
                      background: isOpen ? t.accent : "transparent",
                      transform: isOpen ? "rotate(45deg)" : undefined,
                    }}
                    aria-hidden
                  >
                    +
                  </span>
                </div>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4">
                      <ThemeRehearsalPreview t={t} seed={2.4 + i} waveformHeight={44} />
                      <p className="mt-3 font-mono-tb text-[10px] uppercase leading-relaxed tracking-[0.16em]" style={{ color: t.mute }}>
                        {t.sub}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
    <section id="pricing" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="06"
        kicker="PRICING"
        title="ONE SURFACE."
        accent="FOUR ROOMS."
        description="Pricing scales with the room you're working in — not with how many seconds of audio you happened to upload this month."
      />

      <div className="mt-12 grid gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-2 xl:grid-cols-4">
        {tiers.map((t, i) => (
          <LandingHoverCard
            key={t.tag}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            lift={4}
            className={`group relative flex flex-col p-7 transition-colors ${
              t.featured ? "bg-card" : "landing-hover-surface bg-background hover:bg-card"
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
          </LandingHoverCard>
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
    <section id="join" className="relative landing-section-border px-4 py-24 md:px-8 md:py-32">
      <div
        aria-hidden
        className="landing-full-bleed-abs pointer-events-none absolute inset-0 tb-grid-bg-landing"
      />
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
    <footer className="landing-full-bleed px-4 py-10 md:px-8">
      <div className="mx-auto w-full max-w-[1920px]">
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
          ["CO", ["About", "Brandbook v0.1", "UI Kit", "Changelog", "Contact"]],
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
            <span className="text-(--signal)">● SYS OK</span>
          </span>
          <span>
            TRACKBASE <span className="text-foreground">// v0.1</span> · © 2026
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
 * Page root
 * ============================================================ */

export default function LandingPage({
  isAuthenticated = false,
  signInHref = "/auth",
}: {
  isAuthenticated?: boolean;
  signInHref?: string;
}) {
  return (
    <div className="landing-page min-h-screen" data-theme="ember-dark">
      <div className="mx-auto w-full max-w-[1920px]">
        <main className="min-h-screen bg-background text-foreground">
          <TopBar isAuthenticated={isAuthenticated} />
          <Hero signInHref={signInHref} />
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
    </div>
  );
}
