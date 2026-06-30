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
import { ChordPlaybackRow } from "@/components/ChordPlaybackRow";
import { sectionLabel } from "@/components/StructureEditor";
import { MobileMixerVersionBar } from "@/components/MobileMixerVersionBar";
import { formatChordsDisplay } from "@/lib/chords";
import { findSectionRangeAtTime } from "@/lib/sectionPlayback";
import type { Section, Version } from "@/lib/types";
import { useLandingAuth } from "@/hooks/useLandingAuth";
import { SeededWaveform } from "@/components/WaveformBars";
import {
  Users, Tag, Activity, BarChart3,
  GitBranch, GitMerge, History,
  AudioWaveform, Volume2, Mic, Timer, MessageSquare,
  LayoutGrid, Music2, Layers, ListMusic,
  GitCompare, Headphones, Play,
  Paperclip, Link2, FileText, Compass, CheckSquare, Pin,
  Smartphone, SlidersHorizontal, Repeat,
  FileAudio, Share2, Eye, Hash,
  Disc3, KeyRound, Zap, Lightbulb, Check, Sparkles,
  Lock, Unlock, Plug,
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

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
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

function LimeTag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border border-[color-mix(in_oklab,var(--lime)_60%,transparent)] px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-lime ${className}`}
    >
      <span className="size-1.5 bg-lime tb-blink" />
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
          <span className="text-lime">{index}</span> · {kicker}
        </MonoLabel>
        <MonoLabel className="hidden md:inline">#{kicker.toLowerCase().replace(/\s+/g, "-")}</MonoLabel>
      </div>
      <h2
        className="font-display-tb text-[2.6rem] font-bold leading-[0.95] tracking-[-0.02em] text-foreground md:text-[3.75rem] lg:text-[4.5rem]"

      >
        {title}{" "}
        {accent && <span className="text-lime">{accent}</span>}
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
  variant?: "ghost" | "lime" | "outline";
  className?: string;
  href?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const fontClass = variant === "lime" ? "tb-btn-accent" : "font-mono-tb";
  const trackingClass = variant === "lime" ? "" : "tracking-[0.22em]";
  const styles =
    variant === "lime"
      ? "bg-lime text-primary-foreground"
      : variant === "outline"
        ? "border border-[color-mix(in_oklab,var(--foreground)_30%,transparent)] text-foreground hover:border-lime hover:text-lime"
        : "border border-border text-foreground hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)] hover:text-lime";

  const transitionClass = variant === "lime" ? "transition-[transform,colors]" : "transition-colors";
  const cls = `group relative inline-flex items-center gap-2 px-5 py-3 ${fontClass} text-[11px] uppercase ${trackingClass} ${transitionClass} ${styles} ${className}`;

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
 * Pill waveform (design-system bars)
 * ============================================================ */

function Waveform({
  seed = 1,
  bars = 64,
  color = "var(--lime)",
  height = 88,
  active = true,
}: {
  seed?: number;
  bars?: number;
  color?: string;
  height?: number;
  active?: boolean;
  density?: number;
}) {
  return (
    <SeededWaveform
      seed={seed}
      bars={bars}
      color={color}
      height={height}
      progress={active ? 1 : 0}
    />
  );
}

/* ============================================================
 * Top nav
 * ============================================================ */

function TopBar({
  authHref = "/auth",
  authLabel = "+ SIGN IN",
}: {
  authHref?: string;
  authLabel?: string;
}) {
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
  useEffect(() => {
    if (!open) return;

    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const unlock = () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };

    const onViewportChange = (e: MediaQueryListEvent) => {
      if (!e.matches) unlock();
    };
    mq.addEventListener("change", onViewportChange);

    return () => {
      mq.removeEventListener("change", onViewportChange);
      unlock();
    };
  }, [open]);
  const navItems: Array<[string, string]> = [
    ["#top", "HOME"],
    ["#versioning", "VERSIONING"],
    ["#workflow", "WORKFLOW"],
    ["#philosophy", "PHILOSOPHY"],
    ["#themes", "THEMES"],
    ["#rehearsal", "REHEARSAL"],
    ["#system", "SYSTEM"],
    ["#roadmap", "ROADMAP"],
  ];

  return (
    <div className="landing-full-bleed sticky top-0 z-40 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_95%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-6 md:gap-10">
          <a href="#top" className="flex shrink-0 items-center gap-2 text-foreground">
            <span
              className="font-display-tb text-base font-bold tracking-tight text-lime sm:text-lg md:text-xl lg:text-2xl"
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
                className="font-mono-tb text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-lime"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span
            suppressHydrationWarning
            className="hidden items-center gap-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground lg:inline-flex"
          >
            <span className="size-1.5 rounded-full bg-(--signal) tb-blink" />
            SYS OK · {time || "00:00"}
          </span>
          <a
            href={authHref}
            className="tb-btn-accent hidden items-center gap-2 bg-lime px-3 py-2 text-[11px] uppercase text-primary-foreground transition-colors sm:inline-flex"
          >
            {authLabel}
          </a>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="group inline-flex items-center gap-2.5 py-1 md:hidden"
          >
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors group-hover:text-lime">
              {open ? "Close" : "Menu"}
            </span>
            <span className="relative flex h-3 w-5 flex-col justify-between" aria-hidden>
              <motion.span
                initial={false}
                animate={{ rotate: open ? 45 : 0, y: open ? 6 : 0 }}
                className="block h-px w-full origin-left bg-lime transition-colors"
              />
              <motion.span
                initial={false}
                animate={{ opacity: open ? 0 : 1, scaleX: open ? 0 : 1 }}
                className="block h-px w-3 self-end bg-muted-foreground transition-colors group-hover:bg-lime/70"
              />
              <motion.span
                initial={false}
                animate={{ rotate: open ? -45 : 0, y: open ? -6 : 0 }}
                className="block h-px w-full origin-left bg-lime transition-colors"
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
                  className="group flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_40%,transparent)] py-3 font-mono-tb text-[12px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-lime"
                >
                  <span className="flex items-center gap-3">
                    <span className="size-1.5 bg-lime opacity-50 transition-opacity group-hover:opacity-100" />
                    {label}
                  </span>
                  <span className="text-lime opacity-0 transition-opacity group-hover:opacity-100">→</span>
                </motion.a>
              ))}
              <a
                href={authHref}
                onClick={() => setOpen(false)}
                className="tb-btn-accent mt-3 mb-2 flex items-center justify-center gap-2 bg-lime px-4 py-3 text-[11px] uppercase text-primary-foreground"
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
  const mounted = useMounted();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);
  const reduce = useReducedMotion();
  const parallaxStyle = mounted && !reduce ? { y, opacity } : undefined;

  return (
    <section ref={ref} id="top" className="relative">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 landing-abs-bleed z-0 tb-grid-bg-landing"
        />
        <div className="relative z-10">
          <div className="relative overflow-hidden">
            <motion.div style={parallaxStyle} className="relative px-4 pt-16 pb-10 md:px-8 md:pt-24 md:pb-14">
        {mounted && !reduce && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--lime)_60%,transparent)] to-transparent"
            initial={{ y: -200 }}
            animate={{ y: 900 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
        )}

        <div className="relative mb-10 flex flex-wrap items-center gap-4">
          <LimeTag>PRIVATE BETA · OPEN · V0.1</LimeTag>
        </div>

        <h1 className="relative font-display-tb font-bold leading-[0.82] tracking-[-0.045em]">
          <span className="block text-[clamp(3.2rem,13vw,12rem)] text-lime">
            TRACKBASE
          </span>
          <span className="mt-1 block text-[clamp(1.6rem,6vw,5rem)] tracking-[-0.03em] text-muted-foreground/70">
            STUDIO
          </span>
        </h1>

        <p className="relative mt-8 max-w-3xl font-display-tb text-[clamp(1.25rem,2.6vw,2.1rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
          Music is a <span className="text-lime">process</span>. Not a file.
        </p>

        <div className="relative mt-10 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <p className="max-w-xl font-mono-tb text-[15px] leading-relaxed text-muted-foreground md:text-[1rem]">
            A track doesn't arrive finished. It moves through dozens of iterations, arguments,
            voice memos and renamed exports. TrackBase is the collaborative surface where bands
            think, branch and decide together — versioned, structured, indexed.
          </p>

          <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <MonoLabel>ACTIVE PROJECT · MAIN</MonoLabel>
              <MonoLabel className="text-lime">142 BPM · A#m</MonoLabel>
            </div>
            <Waveform seed={3.1} bars={56} color="var(--lime)" height={64} />
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
          <GhostButton variant="lime" href={signInHref}>+ Start a band</GhostButton>
        </div>
          </motion.div>
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
            <span className="size-1 bg-lime" />
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
    <section id="philosophy" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="03"
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
              <span className="font-mono-tb text-xs uppercase tracking-[0.22em] text-lime">{p.n}</span>
              <span className="size-2 bg-lime tb-blink" />
            </div>
            <h3
              className="font-display-tb font-bold leading-tight tracking-tight text-2xl md:text-3xl"
            >
              {p.t}
            </h3>
            <p className="mt-4 font-mono-tb text-sm leading-relaxed text-muted-foreground">{p.d}</p>
            <div className="landing-hover-divider mt-8 h-px w-full bg-[color-mix(in_oklab,var(--border)_60%,transparent)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--lime)_60%,transparent)]" />
          </LandingHoverCard>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
 * Branch / version showcase
 * ============================================================ */

const LANDING_BPM = 142;
const LANDING_BAR_MS = (60 / LANDING_BPM) * 4 * 1000;
/** Bar 9 — verse (Am F C G), highlights F; matches section pill + chord row. */
const LANDING_PLAYHEAD_MS = Math.round(9 * LANDING_BAR_MS);

function landingMockSection(
  id: string,
  type: Section["type"],
  start_bar: number,
  end_bar: number,
  chords: string,
  position: number,
): Section {
  return {
    id,
    version_id: "landing",
    project_id: "landing",
    type,
    custom_name: null,
    start_bar,
    end_bar,
    chords,
    color: "",
    position,
    created_at: "",
  };
}

const LANDING_MOCK_SECTIONS: Section[] = [
  landingMockSection("s-intro", "intro", 0, 8, "Am F C G", 0),
  landingMockSection("s-verse", "verse", 8, 24, "Am F C G", 1),
  landingMockSection("s-pre", "pre-chorus", 24, 32, "F G Am", 2),
  landingMockSection("s-chorus", "chorus", 32, 48, "C G Am F", 3),
  landingMockSection("s-bridge", "bridge", 48, 60, "Dm Am Em G", 4),
  landingMockSection("s-chorus2", "chorus", 60, 72, "C G Am F", 5),
];

const LANDING_MOBILE_MIXER_SECTIONS = LANDING_MOCK_SECTIONS.filter(
  (s) => s.id !== "s-pre" && s.id !== "s-chorus2",
);

const LANDING_MOCK_VERSIONS: Version[] = [
  {
    id: "v-main",
    project_id: "landing",
    parent_id: null,
    name: "MAIN",
    type: "main",
    created_at: "",
    merged_at: null,
    merged_into_id: null,
    tag: null,
    tracks: [],
  },
  {
    id: "v-alt",
    project_id: "landing",
    parent_id: "v-main",
    name: "ALT-BRIDGE",
    type: "branch",
    created_at: "",
    merged_at: null,
    merged_into_id: null,
    tag: null,
    tracks: [],
  },
  {
    id: "v-dark",
    project_id: "landing",
    parent_id: "v-main",
    name: "DARKER-MIX",
    type: "branch",
    created_at: "",
    merged_at: "2024-06-14T00:00:00Z",
    merged_into_id: "v-main",
    tag: null,
    tracks: [],
  },
  {
    id: "v-new",
    project_id: "landing",
    parent_id: "v-main",
    name: "NEW",
    type: "branch",
    created_at: "",
    merged_at: null,
    merged_into_id: null,
    tag: null,
    tracks: [],
  },
];

function landingSectionTimeRange(startBar: number, endBar: number, barDurationMs: number) {
  const fmt = (secs: number) => {
    const s = Math.floor(secs);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };
  const start = fmt((startBar * barDurationMs) / 1000);
  const end = fmt((endBar * barDurationMs) / 1000);
  return `${start}–${end}`;
}

function landingSectionStartTime(startBar: number, barDurationMs: number) {
  const s = Math.floor((startBar * barDurationMs) / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function landingActiveSectionIdx(
  sections: Section[],
  currentTimeMs: number,
  barDurationMs: number,
): number {
  const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar);
  const match = findSectionRangeAtTime(
    sorted.map((s) => ({ id: s.id, start_bar: s.start_bar, end_bar: s.end_bar })),
    currentTimeMs / 1000,
    barDurationMs / 1000,
  );
  if (!match) return 0;
  const idx = sections.findIndex((s) => s.id === match.id);
  return idx >= 0 ? idx : 0;
}

function LandingMobileSectionChords({
  sections,
  currentTimeMs = LANDING_PLAYHEAD_MS,
  flush = false,
}: {
  sections: Section[];
  currentTimeMs?: number;
  /** Full-bleed strip inside a padded card mock (`-mx-3`, interior `px-3`). */
  flush?: boolean;
}) {
  const activeSectionIdx = landingActiveSectionIdx(sections, currentTimeMs, LANDING_BAR_MS);
  const active = sections[activeSectionIdx];
  const bleed = flush ? "-mx-3" : "";
  const pad = "px-3";
  const border = "border-[color-mix(in_oklab,var(--border)_80%,transparent)]";

  return (
    <div className={`mb-3 min-w-0 overflow-hidden ${bleed}`}>
      <div className={`bg-[color-mix(in_oklab,var(--card)_30%,transparent)] py-2 shrink-0`}>
        <div className={`mb-1.5 flex items-center justify-between gap-2 ${pad}`}>
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Section</span>
          {active && (
            <span className="truncate text-[9px] tabular-nums text-lime">
              ● <span className="tb-section-name uppercase tracking-widest">{sectionLabel(active)}</span>
              <span className="font-mono"> · {landingSectionTimeRange(active.start_bar, active.end_bar, LANDING_BAR_MS)}</span>
            </span>
          )}
        </div>
        <div
          className={`flex gap-1.5 overflow-x-auto pb-1 scrollbar-none ${flush ? "-mx-3 px-3" : pad}`}
        >
          {sections.map((s, i) => (
            <div
              key={s.id}
              className={`shrink-0 border px-2.5 py-1.5 text-[10px] uppercase tracking-widest ${
                i === activeSectionIdx
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <div className="tb-section-name">{sectionLabel(s)}</div>
              <div className="truncate font-mono text-[8px] tabular-nums opacity-80">
                {landingSectionTimeRange(s.start_bar, s.end_bar, LANDING_BAR_MS)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {sections.some((s) => s.chords?.trim()) && (
        <div
          className={`border-t border-b ${border} bg-[color-mix(in_oklab,var(--card)_20%,transparent)] shrink-0 min-w-0`}
        >
          <div className="flex min-h-[40px] min-w-0 items-stretch">
            <div
              className={`flex shrink-0 items-center self-stretch border-r border-[color-mix(in_oklab,var(--border)_50%,transparent)] ${pad}`}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Chords</span>
            </div>
            <ChordPlaybackRow
              sections={sections}
              currentTimeMs={currentTimeMs}
              barDurationMs={LANDING_BAR_MS}
              compact
              className="min-w-0 flex-1 self-stretch"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LandingStructureStrip() {
  const totalBars = 72;
  const barGridStep = 4;
  const RULER_H = 40;
  const RIBBON_H = 32;
  const CHORDS_H = 44;
  const tp = (bar: number) => bar / totalBars;
  const sectionBorder = "1px solid color-mix(in oklab, var(--border) 85%, var(--lime) 15%)";
  const playheadPct = (LANDING_PLAYHEAD_MS / LANDING_BAR_MS / totalBars) * 100;

  return (
    <>
      <div className="mb-3 sm:hidden">
        <LandingMobileSectionChords
          sections={LANDING_MOBILE_MIXER_SECTIONS}
        />
      </div>
      <div className="mb-3 hidden items-stretch border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:flex">
        {/* Label column — aligned with track rows below */}
        <div className="hidden w-[160px] shrink-0 flex-col border-r border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] sm:flex">
          <div
            className="flex flex-col justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3"
            style={{ height: RULER_H }}
          >
            <span className="pt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              CHANNEL
            </span>
            <span className="pb-1.5 font-mono text-[9px] font-normal normal-case tracking-normal text-foreground/60">
              {totalBars} bars · 4/4
            </span>
          </div>
          <div
            className="flex flex-col justify-center bg-lime-soft/40 px-3"
            style={{ height: RIBBON_H }}
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-lime">
              STRUCTURE
            </span>
          </div>
          <div
            className="flex items-center justify-center border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] px-3"
            style={{ height: CHORDS_H }}
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Chords
            </span>
          </div>
        </div>

        {/* Timeline — bar ruler + structure + chords */}
        <div className="relative min-w-0 flex-1 bg-[color-mix(in_oklab,var(--card)_30%,transparent)]">
          <div
            className="absolute top-0 z-[15] w-px -ml-px bg-foreground/70 pointer-events-none"
            style={{ left: `${playheadPct}%`, height: RULER_H + RIBBON_H }}
          />

          <div
            className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]"
            style={{ height: RULER_H }}
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

          <div className="relative overflow-hidden bg-lime-soft/40" style={{ height: RIBBON_H }}>
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

            {LANDING_MOCK_SECTIONS.map((s) => (
              <div
                key={s.id}
                className="absolute inset-y-0 flex items-center overflow-hidden px-2"
                style={{
                  left: `${tp(s.start_bar) * 100}%`,
                  width: `${(tp(s.end_bar) - tp(s.start_bar)) * 100}%`,
                  borderLeft: sectionBorder,
                  borderRight: sectionBorder,
                  background: "color-mix(in oklab, var(--lime) 12%, transparent)",
                }}
              >
                <span className="tb-section-name pointer-events-none w-full truncate text-[9px] uppercase tracking-widest leading-tight text-lime">
                  {sectionLabel(s)}
                </span>
              </div>
            ))}
          </div>

          <div
            className="relative overflow-hidden border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)]"
            style={{ minHeight: CHORDS_H }}
          >
            <ChordPlaybackRow
              sections={LANDING_MOCK_SECTIONS}
              currentTimeMs={LANDING_PLAYHEAD_MS}
              barDurationMs={LANDING_BAR_MS}
              className="h-full w-full min-w-0"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function LandingMixerScrubBar({ progress = 0, className = "" }: { progress?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <div className={`relative h-2 w-full bg-[color-mix(in_oklab,var(--card)_70%,transparent)] ${className}`}>
      <div className="absolute inset-y-0 left-0 bg-lime" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

function BranchShowcase() {
  const branches = [
    { name: "main", color: "var(--lime)", date: "JUN 11", note: "live · 4 tracks · 2:59" },
    { name: "alt-bridge", color: "var(--wave-violet)", date: "JUN 12", note: "experiment · solo rewrite" },
    { name: "darker-mix", color: "var(--wave-coral)", date: "JUN 14", note: "ready for review" },
    { name: "new", color: "var(--wave-mint)", date: "JUN 14", note: "draft" },
  ];
  return (
    <section id="versioning" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="01"
        kicker="VERSIONING"
        title="BRANCH IT."
        accent="MERGE IT. CHAT IT."
        description="Try the bolder bridge without breaking what already works. Every version is a real artifact with date, author and status — not another file called final_v3_FINAL.wav."
      />

      <div className="mt-12 grid min-w-0 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Version rail */}
        <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <MonoLabel>VERSION HISTORY</MonoLabel>
            <MonoLabel className="text-lime">4</MonoLabel>
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
                    className="font-display-tb text-sm font-semibold text-foreground"

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
          <div className="landing-new-branch-btn mt-4 w-full border border-[color-mix(in_oklab,var(--lime)_60%,transparent)] px-3 py-2 text-left font-mono-tb text-[10px] uppercase tracking-[0.22em] transition-colors">
            <span className="landing-new-branch-btn-icon opacity-60">⌥</span> + NEW VERSION
          </div>
        </div>

        {/* Mixer board */}
        <div className="relative flex min-w-0 flex-col overflow-hidden border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] p-4 md:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <MonoLabel>PROJECT · NORTHERN ROOM</MonoLabel>
            <div className="min-w-0 sm:ml-auto sm:max-w-md sm:flex-1">
              <MobileMixerVersionBar
                versions={LANDING_MOCK_VERSIONS}
                activeId="v-main"
                onSelect={() => {}}
                switchOnly
              />
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
              className="group grid min-w-0 grid-cols-1 items-center gap-2 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-3 first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="grid size-7 place-items-center font-mono-tb text-[11px] font-bold text-primary-foreground"
                    style={{ background: t.color }}
                  >
                    {t.name[0]}
                  </span>
                  <div className="min-w-0">
                    <div
                      className="font-display-tb text-xs font-semibold tracking-tight"

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
              <div className="min-w-0 overflow-hidden">
                <Waveform seed={t.seed} bars={48} color={t.color} height={56} />
              </div>
            </motion.div>
          ))}

          <div className="mt-4 flex items-center justify-between border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center bg-lime text-primary-foreground">▶</span>
              <span className="font-mono-tb text-[11px] text-muted-foreground">1:00 / 2:59</span>
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

          <LandingMixerScrubBar progress={100 / 3} className="mt-3" />
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
      <div className={`h-full bg-lime transition-all duration-300 ${filled ? "w-full" : "w-0"}`} />
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
      className="flex h-full flex-col landing-hover-surface landing-hover-border-soft border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5 transition-colors hover:border-[color-mix(in_oklab,var(--lime)_40%,transparent)]"
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
        {badge && <MonoLabel className="shrink-0 text-lime">{badge}</MonoLabel>}
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
            className="grid size-7 place-items-center border border-border text-muted-foreground transition hover:border-lime hover:text-lime"
          >
            <LandingRoadmapChevronLeft />
          </button>
          <button
            type="button"
            aria-label="Advance to next stage"
            className="tb-btn-accent inline-flex h-7 items-center gap-1 border border-lime bg-lime px-2.5 text-[10px] font-bold uppercase text-primary-foreground transition"
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
                        ? "border-lime bg-lime text-primary-foreground"
                        : state === "current"
                          ? "border-lime bg-background text-lime ring-2 ring-lime/30"
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
          <span className="text-lime">
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
    <span className="bg-lime-soft/50 px-0.5 font-bold text-lime">{children}</span>
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
    <div className="relative flex h-10 w-full flex-col justify-center border-b-2 border-lime bg-lime-soft/40 px-3 text-left">
      <div className="text-[10px] font-bold uppercase leading-none tracking-widest text-lime">
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
      caption="Project chat with @mentions, version links, track refs, and timecodes — decisions stay where the song lives."
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
                  <span className="font-bold text-lime">@{m.user}</span>
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
          ? "border-lime bg-lime text-primary-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function LandingRehearsalMock() {
  const listSections = LANDING_MOBILE_MIXER_SECTIONS;

  return (
    <LandingWorkflowCard
      kicker="REHEARSAL VIEW · MOBILE"
      badge="LIVE"
      caption="Open the phone at the rehearsal room. Full mix, structure, chords, click — no laptop, no DAW."
    >
      <div className="mx-auto w-full max-w-[320px] border-2 border-border bg-background">
        <div className="p-3">
          <div className="mb-3 flex items-center justify-between">
            <MonoLabel className="text-lime">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 bg-lime tb-blink" /> REHEARSAL
              </span>
            </MonoLabel>
            <MonoLabel>142 BPM · Am</MonoLabel>
          </div>
          <Waveform seed={5.6} bars={42} color="var(--lime)" height={70} />
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
            <span>{landingSectionStartTime(8, LANDING_BAR_MS)}</span>
            <span>{landingSectionStartTime(24, LANDING_BAR_MS)}</span>
          </div>

          <div className="mt-3">
            <MobileMixerVersionBar
              versions={LANDING_MOCK_VERSIONS}
              activeId="v-main"
              onSelect={() => {}}
              switchOnly
            />
          </div>

          <LandingMobileSectionChords
            sections={listSections}
            flush
          />

          <div className="mt-3 border border-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Structure & chords
            </div>
            <div className="divide-y divide-border">
              {listSections.map((section) => (
                <div
                  key={section.id}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                >
                  <div className="tb-section-name w-14 shrink-0 pt-0.5 text-[9px] uppercase tracking-widest text-lime">
                    {sectionLabel(section)}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-left text-xs leading-relaxed text-foreground">
                    {formatChordsDisplay(section.chords)}
                  </div>
                  <div className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {landingSectionStartTime(section.start_bar, LANDING_BAR_MS)}
                  </div>
                </div>
              ))}
            </div>
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
              className="mx-auto grid size-12 place-items-center bg-lime text-primary-foreground transition active:scale-95"
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
    <section id="workflow" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
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
 * Feature index
 * ============================================================ */

function FeatureIndex() {
  type Item = { label: string; icon: ComponentType<{ size?: number; className?: string }> };
  const groups: Array<{ n: string; t: string; accent: string; items: Item[] }> = [
    {
      n: "06.1", t: "ORGANIZATION", accent: "var(--wave-violet)",
      items: [
        { label: "Bands & invite codes", icon: Users },
        { label: "Custom role tags · guitarist, vocalist, producer", icon: Tag },
        { label: "Real-time activity feed", icon: Activity },
        { label: "Group statistics — versions, applies, comments", icon: BarChart3 },
      ],
    },
    {
      n: "06.2", t: "VERSIONING", accent: "var(--lime)",
      items: [
        { label: "Branch off for experiments — master mix stays untouched", icon: GitBranch },
        { label: "Compare any version to master · review overlaps · apply changes", icon: GitMerge },
        { label: "Full version history · creation date and tags", icon: History },
      ],
    },
    {
      n: "06.3", t: "MIXER", accent: "var(--wave-mint)",
      items: [
        { label: "Multi-track waveforms", icon: AudioWaveform },
        { label: "Mute · Solo · Offset · Replace", icon: Volume2 },
        { label: "Record straight into the project", icon: Mic },
        { label: "Metronome · count-in · loop section", icon: Timer },
        { label: "Range comments with threads", icon: MessageSquare },
        { label: "MIDI editor · draw & select · snap-to-grid · undo/redo", icon: MessageSquare },
      ],
    },
    {
      n: "06.4", t: "STRUCTURE & CHORDS", accent: "var(--wave-amber)",
      items: [
        { label: "Mark every part of the track — chorus, bridge, or super-mega-breakdown", icon: LayoutGrid },
        { label: "Chord-per-section · auto-detect", icon: Music2 },
        { label: "Structure overlay above waveforms", icon: Layers },
        { label: "Chord chart for rehearsal", icon: ListMusic },
      ],
    },
    {
      n: "06.5", t: "A/B VERSION COMPARISON", accent: "var(--wave-sky)",
      items: [
        { label: "Side-by-side version comparison", icon: GitCompare },
        { label: "Solo individual tracks while comparing", icon: Headphones },
        { label: "Synced playback — hear both versions at once", icon: Play },
      ],
    },
    {
      n: "06.6", t: "RESOURCES", accent: "var(--wave-coral)",
      items: [
        { label: "Attach PDFs, DAW projects, anything", icon: Paperclip },
        { label: "Links attachment", icon: Link2 },
        { label: "Pin resources to a branch or track", icon: Pin },
        { label: "Lyrics editor", icon: FileText },
        { label: "Roadmap stages · current status", icon: Compass },
        { label: "Checklist with assignments", icon: CheckSquare },
      ],
    },
    {
      n: "06.7", t: "MOBILE", accent: "var(--lime-bright)",
      items: [
        { label: "Rehearsal view · preview mix, chords, and structure on the go", icon: Smartphone },
        { label: "Mixer · work on tracks anytime, anywhere", icon: SlidersHorizontal },
        { label: "Recording with built-in mic", icon: Mic },
      ],
    },
    {
      n: "06.8", t: "EXPORT & SHARE", accent: "var(--wave-violet)",
      items: [
        { label: "WAV export", icon: FileAudio },
        { label: "Member-only project share links", icon: Share2 },
        { label: "Quick Peek — preview-mix from band page", icon: Eye },
        { label: "Per-project & per-band chat with @mentions, version & track refs", icon: Hash },
      ],
    },
  ];

  return (
    <section id="system" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="06"
        kicker="SYSTEM"
        title="THE FULL"
        accent="STUDIO SURFACE."
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
              className="font-display-tb font-bold tracking-tight text-lg"

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
      body: "Drop a range comment on bar 32 from the rehearsal room. By soundcheck, the bassist has already replied — with an alt take pushed to a new version.",
    },
  ];

  return (
    <section id="rehearsal" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="05"
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
              <MonoLabel className="text-lime">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 bg-lime tb-blink" /> REHEARSAL
                </span>
              </MonoLabel>
              <MonoLabel>142 BPM · A#m</MonoLabel>
            </div>

            <div className="flex shrink-0 flex-col border border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-[color-mix(in_oklab,var(--background)_60%,transparent)] p-3">
              <Waveform seed={7.3} bars={48} color="var(--lime)" height={84} />
              <div className="mt-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>0:42</span>
                <motion.span
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className="text-lime"
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
                      ? "bg-lime text-primary-foreground"
                      : "border border-border text-muted-foreground hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)] hover:text-lime"
                  }`}
                >
                  {s}
                </motion.span>
              ))}
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] pt-3">
              <div className="mb-1 shrink-0 font-mono-tb text-[9px] uppercase tracking-[0.22em] text-lime">CHORUS</div>
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
                        ? "border-lime bg-[color-mix(in_oklab,var(--lime)_10%,transparent)] text-lime"
                        : "border-border text-foreground"
                    }`}
                  >
                    {c}
                  </motion.span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid shrink-0 grid-cols-3 gap-1.5">
              <button className="tb-btn-accent flex items-center justify-center gap-1.5 bg-lime py-2 text-[10px] uppercase text-primary-foreground transition-colors">
                ▶ PLAY
              </button>
              <button className="flex items-center justify-center gap-1.5 border border-border py-2 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:border-lime hover:text-lime">
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
                <span className="landing-hover-bar absolute inset-x-0 top-0 h-[2px] bg-lime transition-transform duration-500" />
                <div className="mb-4 flex items-center justify-between">
                  <span className="landing-hover-icon grid size-10 place-items-center border border-[color-mix(in_oklab,var(--lime)_60%,transparent)] text-lime transition-[color,background-color,border-color] duration-300 group-hover:border-lime group-hover:bg-lime group-hover:!text-primary-foreground">
                    <Icon size={18} className="transition-colors duration-300" />
                  </span>
                  <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {s.kicker}
                  </span>
                </div>
                <h3
                  className="font-display-tb font-bold leading-tight tracking-tight text-xl md:text-2xl"

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
    { id: "lime",              name: "LIME",              sub: "Bone-black canvas, chartreuse signal.",   bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "#dfff00",  fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "blush-light",       name: "BLUSH LIGHT",       sub: "Clean white, rose-pink signature.",     bg: "oklch(0.97 0 0)",        surface: "oklch(1 0 0)",           line: "oklch(0.85 0 0)",        accent: "oklch(0.58 0.22 350)", fg: "oklch(0.16 0 0)",       mute: "oklch(0.42 0 0)" },
    { id: "blush-dark",        name: "BLUSH DARK",        sub: "Deep black, vivid blush accent.",       bg: "oklch(0.13 0 0)",        surface: "oklch(0.16 0 0)",        line: "oklch(0.26 0 0)",        accent: "oklch(0.72 0.20 350)", fg: "oklch(0.93 0 0)",       mute: "oklch(0.58 0 0)" },
    { id: "studio-dim-light",  name: "STUDIO DIM LIGHT",  sub: "Cool slate day, same teal signal.",     bg: "oklch(0.96 0.018 250)",  surface: "oklch(0.99 0.012 250)", line: "oklch(0.84 0.02 250)",  accent: "oklch(0.48 0.15 200)", fg: "oklch(0.18 0.02 250)", mute: "oklch(0.44 0.016 250)" },
    { id: "studio-dark",       name: "STUDIO DIM",        sub: "Slate-blue night, cool teal signal.",   bg: "oklch(0.19 0.012 250)",  surface: "oklch(0.22 0.014 250)", line: "oklch(0.30 0.014 250)", accent: "oklch(0.74 0.13 200)", fg: "oklch(0.92 0.005 250)", mute: "oklch(0.66 0.012 250)" },
    { id: "studio-light",      name: "STUDIO LIGHT",      sub: "Warm daylight, muted indigo accent.",   bg: "oklch(0.985 0.003 80)",  surface: "oklch(1 0 0)",          line: "oklch(0.88 0.005 80)",  accent: "oklch(0.52 0.14 282)", fg: "oklch(0.22 0.01 260)",  mute: "oklch(0.46 0.01 260)" },
    { id: "studio-paper-dark", name: "STUDIO PAPER DARK", sub: "Warm amber dark, same indigo depth.",   bg: "oklch(0.17 0.014 80)",   surface: "oklch(0.20 0.016 80)",  line: "oklch(0.30 0.016 80)",  accent: "oklch(0.62 0.15 282)", fg: "oklch(0.92 0.008 80)",  mute: "oklch(0.62 0.012 80)" },
  ];

  const [desktopActive, setDesktopActive] = useState(0);
  const [mobileThemeOpen, setMobileThemeOpen] = useState<number | null>(0);

  return (
    <section id="themes" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="04"
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
                        className="font-display-tb text-lg font-bold tracking-tight"

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
                      style={{
                        color: t.fg,
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                      }}
                      className="font-display-tb text-[1rem] font-bold uppercase tracking-tight"
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
                    className="font-display-tb truncate text-lg font-bold tracking-tight"
                    style={{
                      color: t.fg,
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
        "Unlimited versions",
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
      color: "var(--lime)",
      features: [
        "Unlimited projects",
        "10 GB per project",
        "Versions, applies, version history",
        "MIDI · piano roll · GM bank",
        "Range comments & threads",
        "Chat with version & track refs",
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
              <div className="absolute -top-px left-0 right-0 h-[3px] bg-lime" />
            )}

            <div className="mb-4 flex items-center gap-2">
              <span className="size-2.5" style={{ background: t.color }} />
              <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {t.tag}
              </span>
            </div>

            <h3
              className="font-display-tb font-bold tracking-tight text-2xl text-foreground"

            >
              {t.name}
            </h3>
            <p className="mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
              {t.blurb}
            </p>

            <div className="mt-6 flex items-baseline gap-2 border-y border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-5">
              <span
                className="font-display-tb font-bold tracking-tight text-5xl text-foreground"

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
                className={`group/btn flex w-full items-center justify-between border px-4 py-3 text-[11px] uppercase transition-all ${
                  t.featured
                    ? "tb-btn-accent border-lime bg-lime text-primary-foreground"
                    : "font-mono-tb tracking-[0.22em] border-[color-mix(in_oklab,var(--foreground)_40%,transparent)] text-foreground hover:border-lime hover:text-lime"
                }`}
              >
                <span>{t.cta}</span>
                <motion.span className="inline-block" initial={false} whileHover={{ x: 4 }}>→</motion.span>
              </a>
              {t.featured && (
                <div className="mt-2 flex items-center gap-1.5 font-mono-tb text-[9px] uppercase tracking-[0.22em] text-lime">
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
 * Roadmap
 * ============================================================ */

type RoadmapGridPos = { row: number; col: number };

function roadmapSnakePosition(index: number, cols: number, total: number): RoadmapGridPos {
  const rowIdx = Math.floor(index / cols);
  const posInRow = index % cols;
  const itemsInRow = Math.min(cols, total - rowIdx * cols);
  const isRtlRow = rowIdx % 2 === 1;
  const colIdx = isRtlRow ? itemsInRow - 1 - posInRow : posInRow;
  return { row: rowIdx + 1, col: colIdx + 1 };
}

function roadmapGridColumns(container: HTMLElement): number {
  const template = getComputedStyle(container).gridTemplateColumns;
  const tracks = template.split(/\s+/).filter(Boolean);
  return tracks.length || 1;
}

function roadmapNodeCenter(node: HTMLElement, container: HTMLElement) {
  const cb = container.getBoundingClientRect();
  const nb = node.getBoundingClientRect();
  return {
    x: nb.left + nb.width / 2 - cb.left,
    y: nb.top + nb.height / 2 - cb.top,
  };
}

function roadmapConnectorPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromPos: RoadmapGridPos,
  toPos: RoadmapGridPos,
): string {
  if (fromPos.row === toPos.row) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  if (fromPos.col === toPos.col) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

const ROADMAP_ITEMS = [
  {
    id: "private-beta",
    label: "NOW",
    title: "Private beta",
    body: "Invite-only rooms are stress-testing the full workspace — branching, mixer, structure, chat and Rehearsal View — before the doors open wider.",
    icon: Lock,
    color: "var(--lime)",
    active: true,
  },
  {
    id: "open-beta",
    label: "NEXT",
    title: "Open beta",
    body: "More projects, bigger rooms and no invite wall. Anyone can start a band, invite members and push their first commit.",
    icon: Unlock,
    color: "var(--wave-sky)",
    active: false,
  },
  {
    id: "android",
    label: "LAUNCH",
    title: "Android app",
    body: "Chord charts, section loops and the quick recorder land on every Android phone in the band — the same context, pocket-sized.",
    icon: Smartphone,
    color: "var(--wave-mint)",
    active: false,
  },
  {
    id: "ios",
    label: "LATER THIS YEAR",
    title: "iOS app",
    body: "The full Studio experience tuned for iPhone and iPad: rehearsal, review, and quick commits from the practice space or the tour van.",
    icon: Smartphone,
    color: "var(--wave-violet)",
    active: false,
  },
  {
    id: "vst3",
    label: "COMING SOON",
    title: "VST3 plugin",
    body: "Sync changes, pull stems and push markers without leaving your DAW. Version control becomes part of the actual production flow.",
    icon: Plug,
    color: "var(--wave-amber)",
    active: false,
  },
] as const;

function roadmapItemPlacementClass(index: number): string {
  switch (index) {
    case 2:
      return "sm:col-start-2 sm:row-start-2 xl:col-start-auto xl:row-start-auto";
    case 3:
      return "sm:col-start-1 sm:row-start-2 xl:col-start-auto xl:row-start-auto";
    case 4:
      return "sm:col-start-1 sm:row-start-3 xl:col-start-auto xl:row-start-auto";
    default:
      return "";
  }
}

function Roadmap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const recalcConnectors = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const cols = roadmapGridColumns(container);
    const total = ROADMAP_ITEMS.length;
    const itemEls = container.querySelectorAll<HTMLElement>("[data-roadmap-item]");

    setSvgSize({ w: container.offsetWidth, h: container.offsetHeight });

    const paths: string[] = [];
    for (let i = 0; i < total - 1; i++) {
      const fromEl = itemEls[i];
      const toEl = itemEls[i + 1];
      const fromNode = fromEl?.querySelector<HTMLElement>("[data-roadmap-node]");
      const toNode = toEl?.querySelector<HTMLElement>("[data-roadmap-node]");
      if (!fromEl || !toEl || !fromNode || !toNode) continue;

      const fromPos = roadmapSnakePosition(i, cols, total);
      const toPos = roadmapSnakePosition(i + 1, cols, total);
      const from = roadmapNodeCenter(fromNode, container);
      const to = roadmapNodeCenter(toNode, container);
      paths.push(roadmapConnectorPath(from, to, fromPos, toPos));
    }
    setConnectors(paths);
  }, []);

  useEffect(() => {
    recalcConnectors();
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => recalcConnectors());
    ro.observe(container);
    window.addEventListener("resize", recalcConnectors);

    const t1 = window.setTimeout(recalcConnectors, 100);
    const t2 = window.setTimeout(recalcConnectors, 700);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalcConnectors);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [recalcConnectors]);

  return (
    <section id="roadmap" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="07"
        kicker="ROADMAP"
        title="WHAT'S NEXT."
        accent="SHIPPING SOON."
        description="TrackBase Studio is built in public. Private beta is live now; every following release unlocks a new room in the studio."
      />

      <div
        ref={containerRef}
        className="relative mt-14 grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 sm:gap-y-6 xl:grid-cols-5 xl:gap-x-3 xl:gap-y-6"
      >
        {svgSize.w > 0 && svgSize.h > 0 && connectors.length > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={svgSize.w}
            height={svgSize.h}
            viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          >
            <defs>
              <marker
                id="roadmap-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path
                  d="M0,0 L8,4 L0,8"
                  fill="none"
                  stroke="color-mix(in oklab, var(--border) 65%, transparent)"
                  strokeWidth="1"
                />
              </marker>
            </defs>
            {connectors.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="color-mix(in oklab, var(--border) 65%, transparent)"
                strokeWidth="1"
                markerEnd="url(#roadmap-arrow)"
              />
            ))}
          </svg>
        )}

        {ROADMAP_ITEMS.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              data-roadmap-item={i}
              className={`relative min-w-0 ${roadmapItemPlacementClass(i)}`}
            >
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ delay: i * 0.1, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                onAnimationComplete={i === ROADMAP_ITEMS.length - 1 ? recalcConnectors : undefined}
                className="h-full"
              >
                <motion.article
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="relative h-full w-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] p-5 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-(--roadmap-accent) hover:bg-[color-mix(in_oklab,var(--card)_55%,transparent)]"
                  style={{ ["--roadmap-accent" as string]: item.color }}
                >
                <div className="mb-5 flex items-center gap-3">
                  <div
                    data-roadmap-node
                    className="relative z-10 grid size-4 place-items-center"
                    style={{ background: item.color }}
                  >
                    {item.active && (
                      <motion.span
                        className="absolute inset-0 -m-1.5 border"
                        style={{ borderColor: item.color }}
                        animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.8, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                      />
                    )}
                  </div>
                  {item.active && (
                    <span className="tb-btn-accent inline-flex items-center gap-1.5 bg-lime px-2 py-1 text-[9px] uppercase text-primary-foreground">
                      <span className="size-1.5 bg-black tb-blink" />
                      LIVE
                    </span>
                  )}
                </div>

                <div className="mb-4 flex items-center gap-2">
                  <span
                    className="grid size-8 place-items-center border"
                    style={{ borderColor: item.color, color: item.color }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <div>
                    <h3
                      className="font-display-tb text-lg font-bold tracking-tight"

                    >
                      {item.title}
                    </h3>
                    <span className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                </div>
                <p className="font-mono-tb text-[12px] leading-relaxed text-muted-foreground">{item.body}</p>
                </motion.article>
              </motion.div>
            </div>
          );
        })}
      </div>
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
        <LimeTag className="mx-auto">PRIVATE BETA · OPEN</LimeTag>
        <h2
          className="font-display-tb mt-8 font-bold leading-[0.9] tracking-[-0.03em]"
          style={{
            fontSize: "clamp(2.5rem, 8vw, 7rem)",
          }}
        >
          STOP RENAMING <br />
          <span className="text-lime">FINAL_V3_FINAL.zip</span>
        </h2>
        <p className="mx-auto mt-8 max-w-2xl font-mono-tb text-sm leading-relaxed text-muted-foreground md:text-base">
          Bring your band, your roster, your class. TrackBase is free during beta — every workspace
          ships with branches, a mixer, structure, chords, chat and the rehearsal view from day one.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <GhostButton variant="lime" href={signInHref}>+ Create my band</GhostButton>
          <GhostButton variant="outline" href={signInHref}>Talk to us (studios)</GhostButton>
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
            className="font-display-tb font-bold tracking-tight text-lime text-xl"

          >
            TRACKBASE<span className="text-foreground">.</span>
          </div>
          <p className="mt-3 max-w-sm font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Built for musicians, indexed for engineers. Version control for music.
          </p>
        </div>
        {[
          [
            "PRODUCT",
            [
              { label: "Mixer", href: "#system" },
              { label: "Branches", href: "#versioning" },
              { label: "Rehearsal View", href: "#rehearsal" },
              { label: "Roadmap", href: "#roadmap" },
              { label: "Chat", href: "#workflow" },
            ],
          ],
          [
            "FOR",
            [
              { label: "Bands", href: "#join" },
              { label: "Studios", href: "#join" },
              { label: "Schools", href: "#join" },
              { label: "Labels", href: "#join" },
              { label: "Producer centers", href: "#join" },
            ],
          ],
          [
            "CO",
            [
              { label: "About", href: "#philosophy" },
              { label: "Brandbook v0.1", href: "/uikit" },
              { label: "UI Kit", href: "/uikit" },
              { label: "Pricing", href: "#pricing" },
              { label: "Contact", href: "#join" },
            ],
          ],
        ].map(([t, items]) => (
          <div key={t as string}>
            <div className="mb-3 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-lime">
              {t as string}
            </div>
            <ul className="space-y-2">
              {(items as Array<{ label: string; href: string }>).map((item) => (
                <li key={item.label} className="font-mono-tb text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  <a href={item.href}>{item.label}</a>
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

export default function LandingPage() {
  const { authHref, authLabel } = useLandingAuth()

  return (
    <div className="landing-page min-h-screen" data-theme="lime">
      <div className="mx-auto w-full max-w-[1920px]">
        <main className="min-h-screen bg-background text-foreground">
          <TopBar authHref={authHref} authLabel={authLabel} />
          <Hero signInHref={authHref} />
          <BranchShowcase />
          <ProcessShowcase />
          <Philosophy />
          <ThemingSection />
          <RehearsalDeepDive />
          <FeatureIndex />
          <Roadmap />
          <CTA signInHref={authHref} />
          <Footer />
        </main>
      </div>
    </div>
  );
}
