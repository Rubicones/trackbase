"use client";

import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useInView,
  AnimatePresence,
} from "motion/react";
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode, type ComponentType, type ComponentProps } from "react";
import { usePathname } from "next/navigation";
import { UserAvatar } from "@/components/ui/avatar";
import { MetronomeIcon } from "@/components/design/TransportIcons";
import { sectionLabel } from "@/components/StructureEditor";
import type { Section } from "@/lib/types";
import { useLandingAuth } from "@/hooks/useLandingAuth";
import { SeededWaveform } from "@/components/WaveformBars";
import { SEO_FAQS } from "@/lib/seo";
import {
  Users, Tag, Activity, BarChart3,
  GitBranch, GitMerge, History,
  AudioWaveform, Volume2, Mic, Timer, MessageSquare,
  LayoutGrid, Music2, Layers, ListMusic,
  GitCompare, Headphones, Play,
  Paperclip, Link2, FileText, Compass, CheckSquare, Pin,
  Smartphone, SlidersHorizontal,
  FileAudio, Share2, Eye, Hash,
  Check, Sparkles,
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
  seoNote,
}: {
  index: string;
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
  /** Visually hidden but crawlable — spells out the plain-language feature name inside the H2 for search engines and screen readers, without touching the stylized visible heading. */
  seoNote?: string;
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
        {seoNote && <span className="sr-only"> — {seoNote}</span>}
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

/**
 * Reused as-is on standalone pages outside the landing page itself (e.g.
 * /tools/*) so they share the exact same header. Nav items are hash anchors
 * into sections of "/" — hrefFor() prefixes them with "/" when we're not
 * already on the homepage, so they still resolve there instead of being a
 * no-op on the current page.
 */
export function TopBar({
  authHref = "/auth",
  authLabel = "+ SIGN IN",
}: {
  authHref?: string;
  authLabel?: string;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const hrefFor = (hash: string) => (isHome ? hash : `/${hash}`);
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
    ["#features", "FEATURES"],
    ["#mobile", "MOBILE"],
    ["#philosophy", "PHILOSOPHY"],
    ["#themes", "THEMES"],
    ["#system", "SYSTEM"],
    ["#roadmap", "ROADMAP"],
    ["#faq", "FAQ"],
  ];

  return (
    <div className="landing-full-bleed sticky top-0 z-40 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_95%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-6 md:gap-10">
          <a href={hrefFor("#top")} className="flex shrink-0 items-center gap-2 text-foreground">
            <span
              className="font-display-tb text-base font-bold tracking-tight text-lime sm:text-lg md:text-xl lg:text-2xl"
            >
              sonicdesk.
            </span>
            <span className="hidden font-mono-tb text-[10px] text-muted-foreground sm:inline">
              // v0.1
            </span>
          </a>
          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map(([href, label]) => (
              <a
                key={href}
                href={hrefFor(href)}
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
                  href={hrefFor(href)}
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

function HeroMixerMock() {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTime((t) => (t + 1) % 199), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = Math.floor(time / 60);
  const ss = (time % 60).toString().padStart(2, "0");
  const tracks = [
    { n: "GTR", color: "var(--wave-violet)", seed: 3.2 },
    { n: "DRM", color: "var(--wave-mint)", seed: 5.4 },
    { n: "BAS", color: "var(--wave-amber)", seed: 7.6 },
    { n: "VOX", color: "var(--wave-coral)", seed: 9.1, rec: true },
  ];
  return (
    <div className="relative overflow-hidden border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] sm:px-4">
        <span className="truncate text-muted-foreground">
          ACTIVE · <span className="text-foreground">MASTER</span> · 4 TRACKS
        </span>
        <span className="shrink-0 text-lime">142 BPM · A#m</span>
      </div>
      <div className="flex gap-2 p-3 sm:gap-3 sm:p-4">
        <div className="flex shrink-0 flex-col justify-center gap-2" style={{ width: 52 }}>
          {tracks.map((t) => (
            <div key={t.n} className="flex h-7 items-center gap-1.5">
              {t.rec ? (
                <span className="tb-rec size-1.5 rounded-full" style={{ background: t.color }} />
              ) : (
                <span className="size-1.5 rounded-full" style={{ background: t.color }} />
              )}
              <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-foreground">{t.n}</span>
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 space-y-2">
          <div
            aria-hidden
            className="tb-playhead pointer-events-none absolute top-0 bottom-0"
            style={{ width: 1, background: "var(--lime)", boxShadow: "0 0 8px var(--lime)" }}
          />
          {tracks.map((t) => (
            <div key={t.n} className="h-7 min-w-0">
              <Waveform seed={t.seed} bars={64} color={t.color} height={28} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:px-4">
        <span className="truncate">
          {mm}:{ss} <span className="text-foreground">▶ NORTHERN ROOM / v04</span>
        </span>
        <span className="shrink-0">3:18</span>
      </div>
    </div>
  );
}

function Hero({ signInHref = "/auth" }: { signInHref?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);
  const reduce = useReducedMotion();
  const parallaxStyle = mounted && !reduce ? { y, opacity } : undefined;

  const pills: Array<[string, string]> = [
    ["▲", "Versions & diff"],
    ["◆", "Comments on bars"],
    ["●", "Structure + chords"],
    ["◐", "Mobile companion"],
  ];

  return (
    <section ref={ref} id="top" className="relative">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 landing-abs-bleed z-0 tb-grid-bg-landing"
        />
        <div className="relative z-10">
          <div className="relative overflow-hidden">
            <motion.div style={parallaxStyle} className="relative px-4 pt-14 pb-10 md:px-8 md:pt-24 md:pb-14">
        {mounted && !reduce && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--lime)_60%,transparent)] to-transparent"
            initial={{ y: -200 }}
            animate={{ y: 900 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
        )}

        <div className="relative -mt-1 mb-5 flex flex-wrap items-center gap-4 md:mt-0 md:mb-0">
          <LimeTag>PRIVATE BETA · OPEN · V0.1</LimeTag>
        </div>

        <h1 className="relative font-display-tb font-bold leading-[0.82] tracking-[-0.045em]">
          <span className="block text-[clamp(3.2rem,13vw,12rem)] text-lime">
            sonicdesk.
          </span>
          <span className="sr-only"> — the band workspace with version control, comments on bars, chord detection, and rehearsal mode for music bands</span>
        </h1>

        <div className="relative mt-8 grid gap-10 lg:grid-cols-2 lg:items-end md:mt-12">
          <div className="min-w-0">
            <motion.p
              initial={mounted && !reduce ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="font-display-tb text-[clamp(1.25rem,2.6vw,2.1rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground"
            >
              An ultimate workspace <span className="text-lime">for your music.</span>
            </motion.p>
            <motion.p
              initial={mounted && !reduce ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="mt-5 max-w-xl font-mono-tb text-[15px] leading-relaxed text-muted-foreground md:text-[1rem]"
            >
              Branch a mix like code. Comment on bar 34. Map the structure, write the chords,
              rehearse from your phone. Everything your band needs — in one place, versioned
              end-to-end.
            </motion.p>
            <div className="mt-6 flex flex-wrap gap-2">
              {pills.map(([icon, label], i) => (
                <motion.span
                  key={label}
                  initial={mounted && !reduce ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.08 }}
                  className="inline-flex items-center gap-2 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  <span className="text-lime">{icon}</span>
                  {label}
                </motion.span>
              ))}
            </div>
            <div className="relative mt-8 flex flex-wrap items-center gap-3">
              <GhostButton variant="lime" href={signInHref}>+ Start a band</GhostButton>
              <GhostButton variant="outline" href="#versioning">See how it works</GhostButton>
            </div>
          </div>

          <div className="min-w-0">
            <HeroMixerMock />
          </div>
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
      d: "Two solos? Two arrangements? That's not a problem to hide — it's a decision to make. sonicdesk makes it visible.",
    },
  ];
  return (
    <section id="philosophy" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="04"
        kicker="PHILOSOPHY"
        title="THREE THINGS"
        accent="WE BELIEVE."
        description="The product is the consequence of three convictions about how music actually gets made between humans."
      />

      <div className="relative mt-12">
        <div className="relative">
          <div className="select-none font-display-tb text-[100px] leading-none text-[color-mix(in_oklab,var(--lime)_20%,transparent)]">
            &ldquo;
          </div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: 0.9 }}
            className="-mt-6 font-display-tb text-[clamp(2.2rem,6vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.02em] text-foreground"
          >
            Music is a{" "}
            <span className="relative isolate inline-block">
              <span
                aria-hidden
                className="tb-drift pointer-events-none absolute -inset-4 rounded-full bg-[color-mix(in_oklab,var(--lime)_28%,transparent)] blur-2xl"
                style={{ zIndex: -1 }}
              />
              <span className="relative text-lime" style={{ zIndex: 1 }}>process.</span>
            </span>{" "}
            Not a file.
          </motion.p>
          <div className="mt-6 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            — Signed, the sonicdesk team
          </div>
        </div>
      </div>

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

const VERSION_TRACKS = [
  { name: "GTR-RHYTHM", color: "var(--wave-violet)", seed: 2.3 },
  { name: "DRUMS", color: "var(--wave-mint)", seed: 4.7 },
  { name: "BASS", color: "var(--wave-amber)", seed: 6.1 },
  { name: "GTR-SOLO", color: "var(--wave-coral)", seed: 8.4 },
];

type VersionChange = {
  /** index into VERSION_TRACKS */
  track: number;
  kind: "comment" | "indent" | "replace";
  label: string;
} | null;

const VERSIONS: Array<{
  name: string;
  author: string;
  date: string;
  tag: string;
  color: string;
  chip: string;
  change: VersionChange;
}> = [
  { name: "master", author: "elias", date: "JUN 11", tag: "CURRENT", color: "var(--lime)", chip: "Current master", change: null },
  {
    name: "alt-bridge",
    author: "marek",
    date: "JUN 12",
    tag: "EXP",
    color: "var(--wave-violet)",
    chip: "Solo rewrite · bar 48–56",
    change: { track: 3, kind: "indent", label: "Bar 48–56 · rewrite" },
  },
  {
    name: "darker-mix",
    author: "ava",
    date: "JUN 14",
    tag: "FIX",
    color: "var(--wave-coral)",
    chip: "Bass re-amped · -3dB verbs",
    change: { track: 2, kind: "comment", label: "-3dB verbs" },
  },
  {
    name: "half-time",
    author: "jules",
    date: "JUN 14",
    tag: "ARR",
    color: "var(--wave-sky)",
    chip: "Chorus 2× · new arrangement",
    change: { track: 1, kind: "replace", label: "New arrangement" },
  },
];

function BranchTrackChange({ change, color }: { change: NonNullable<VersionChange>; color: string }) {
  if (change.kind === "comment") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        className="pointer-events-none absolute inset-y-0 left-[18%] right-[46%] border-l-2 border-r-2"
        style={{ borderColor: color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
      >
        <span
          className="absolute -top-4 left-0 whitespace-nowrap font-mono-tb text-[9px] uppercase tracking-[0.18em]"
          style={{ color }}
        >
          💬 {change.label}
        </span>
      </motion.div>
    );
  }
  if (change.kind === "indent") {
    return (
      <motion.div
        initial={{ opacity: 0, scaleX: 0.85 }}
        animate={{ opacity: 1, scaleX: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        className="pointer-events-none absolute inset-y-0 left-[54%] right-[6%] border border-dashed"
        style={{ borderColor: color, transformOrigin: "left" }}
      >
        <span
          className="absolute -top-4 right-0 whitespace-nowrap font-mono-tb text-[9px] uppercase tracking-[0.18em]"
          style={{ color }}
        >
          {change.label}
        </span>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0 }}
      animate={{ opacity: 1, scaleX: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: "left", borderColor: color, background: `color-mix(in oklab, ${color} 10%, transparent)` }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center border border-dashed"
    >
      <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em]" style={{ color }}>
        ⇄ Replaced · {change.label}
      </span>
    </motion.div>
  );
}

function BranchApplyRibbon({ version }: { version: (typeof VERSIONS)[number] }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const ids = [
      setTimeout(() => setStep(1), 400),
      setTimeout(() => setStep(2), 1400),
      setTimeout(() => setStep(3), 2600),
    ];
    return () => ids.forEach(clearTimeout);
  }, [version.name]);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-4 sm:gap-4 sm:px-4">
      <motion.div
        animate={{ x: step >= 1 ? 0 : -8, opacity: step >= 1 ? 1 : 0.4 }}
        transition={{ duration: 0.4 }}
        className="flex min-w-0 items-center gap-2 border px-3 py-2"
        style={{ borderColor: version.color }}
      >
        <span className="size-2 shrink-0" style={{ background: version.color }} />
        <span className="truncate font-mono-tb text-[10px] uppercase tracking-[0.18em]">{version.name}</span>
      </motion.div>
      <motion.div
        animate={{ opacity: step >= 2 ? 1 : 0.3 }}
        className="flex items-center gap-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime"
      >
        <span>APPLY</span>
        <span className="h-px w-6 bg-lime" />
        <span>→</span>
      </motion.div>
      <motion.div
        animate={{ scale: step >= 3 ? 1 : 0.96, opacity: step >= 3 ? 1 : 0.5 }}
        transition={{ duration: 0.4 }}
        className="flex min-w-0 items-center justify-between gap-2 border border-lime px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 bg-lime" />
          <span className="truncate font-mono-tb text-[10px] uppercase tracking-[0.18em] text-foreground">master · updated</span>
        </div>
        <motion.span
          animate={{ opacity: step >= 3 ? 1 : 0, scale: step >= 3 ? 1 : 0.5 }}
          transition={{ duration: 0.3 }}
          className="shrink-0 text-sm text-lime"
        >
          ✓
        </motion.span>
      </motion.div>
    </div>
  );
}

/** Version tree + "what changed" diff board. Exported — reused on /features/versions. */
export function BranchBoard({ className = "" }: { className?: string }) {
  const [active, setActive] = useState(1);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => setActive((a) => (a + 1) % VERSIONS.length), 3600);
    return () => clearInterval(id);
  }, [pinned]);
  const v = VERSIONS[active];

  return (
    <div className={`grid min-w-0 gap-6 lg:grid-cols-[300px_1fr] ${className}`}>
        {/* Version tree */}
        <div className="min-w-0 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
          <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>VERSION TREE</span>
            <span>{VERSIONS.length} · AUTO-ROTATING</span>
          </div>
          <div>
            {VERSIONS.map((ver, i) => (
              <button
                key={ver.name}
                type="button"
                onMouseEnter={() => { setActive(i); setPinned(true); }}
                onMouseLeave={() => setPinned(false)}
                onClick={() => { setActive(i); setPinned(true); }}
                className={`grid w-full grid-cols-[16px_1fr_auto] items-center gap-3 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3 py-3 text-left transition-colors last:border-b-0 ${
                  i === active ? "bg-[color-mix(in_oklab,var(--lime)_8%,transparent)]" : "hover:bg-background"
                }`}
              >
                <span
                  className="size-2.5"
                  style={{ background: ver.color, boxShadow: i === active ? `0 0 10px ${ver.color}` : undefined }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-display-tb text-sm font-semibold text-foreground">{ver.name}</span>
                  <span className="block font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    {ver.author} · {ver.date}
                  </span>
                </span>
                <span
                  className={`border px-1.5 py-0.5 font-mono-tb text-[9px] uppercase tracking-[0.18em] ${
                    i === active ? "border-lime text-lime" : "border-border text-muted-foreground"
                  }`}
                >
                  {ver.tag}
                </span>
              </button>
            ))}
          </div>
          <div className="p-2">
            <div className="w-full border border-dashed border-[color-mix(in_oklab,var(--lime)_40%,transparent)] py-2 text-center font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
              ⌥ + New version from master
            </div>
          </div>
        </div>

        {/* A/B diff board */}
        <div className="min-w-0">
          <div className="relative overflow-hidden border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)]">
            <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0" style={{ background: v.color }} />
                <span className="truncate text-foreground">{v.name}</span>
                <span className="hidden text-muted-foreground sm:inline">· {v.chip}</span>
              </div>
              <span className="shrink-0 text-lime">WHAT CHANGED</span>
            </div>

            <div className="relative p-3 sm:p-6">
              <div className="relative space-y-3">
                <div
                  aria-hidden
                  className="tb-sweep pointer-events-none absolute inset-y-0 w-[3px]"
                  style={{ background: "var(--lime)", boxShadow: "0 0 20px var(--lime)" }}
                />
                {VERSION_TRACKS.map((t, idx) => {
                  const change = v.change && v.change.track === idx ? v.change : null;
                  return (
                    <div key={t.name} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="grid size-6 shrink-0 place-items-center font-mono-tb text-[10px] font-bold text-primary-foreground"
                          style={{ background: t.color }}
                        >
                          {t.name[0]}
                        </span>
                        <span className="truncate font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                          {t.name}
                        </span>
                        <div className="ml-auto flex gap-1">
                          {["M", "S"].map((b) => (
                            <span
                              key={b}
                              className="grid size-4 place-items-center border border-border font-mono-tb text-[8px] text-muted-foreground"
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="relative h-9 min-w-0">
                        <Waveform seed={t.seed} bars={72} color={t.color} height={36} />
                        <AnimatePresence>
                          {change && <BranchTrackChange key={v.name} change={change} color={v.color} />}
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={v.name + "chip"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 }}
                  className="mt-4 inline-flex items-center gap-2 border px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em]"
                  style={{ borderColor: v.color, color: v.color }}
                >
                  <span className="size-1.5" style={{ background: v.color }} />
                  {v.chip}
                </motion.div>
              </AnimatePresence>
            </div>

            <BranchApplyRibbon version={v} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["∞", "VERSIONS"],
              ["0", "LOST TAKES"],
              ["1-CLICK", "APPLY"],
              ["VISUAL", "DIFF"],
            ].map(([k, l]) => (
              <div key={l} className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-3">
                <div className="font-display-tb text-2xl font-bold tracking-tight text-lime">{k}</div>
                <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}

function BranchShowcase() {
  return (
    <section id="versioning" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="01"
        kicker="VERSIONS & DIFF"
        title="BRANCH IT."
        accent="BREAK IT. MERGE IT BACK."
        description="Copy master into a new version. Experiment freely — new take, alt chorus, half-time bridge. When it clicks, apply back to master with a visible diff. Nothing lost, ever."
        seoNote="Version control for music: branch, merge, and compare takes without losing the original mix"
      />

      <BranchBoard className="mt-12" />
    </section>
  );
}

/* ============================================================
 * Roadmap + Chat + Rehearsal
 * ============================================================ */

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

/* ============================================================
 * Features (comments · structure & chords · social)
 * ============================================================ */

function FeaturePanel({
  side,
  eyebrow,
  title,
  copy,
  chips,
  demo,
}: {
  side: "left" | "right";
  eyebrow: string;
  title: string;
  copy: string;
  chips: string[];
  demo: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  return (
    <div ref={ref} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7 }}
        className={`min-w-0 ${side === "right" ? "lg:order-2" : ""}`}
      >
        <MonoLabel className="text-lime">{eyebrow}</MonoLabel>
        <h3 className="mt-4 font-display-tb text-3xl font-bold leading-[0.95] tracking-tight text-foreground md:text-5xl">
          {title}
        </h3>
        <p className="mt-5 max-w-md font-mono-tb text-sm leading-relaxed text-muted-foreground">{copy}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c}
              className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.9, delay: 0.15 }}
        className={`min-w-0 ${side === "right" ? "lg:order-1" : ""}`}
      >
        {demo}
      </motion.div>
    </div>
  );
}

/* --- 02.1 comments demo --- */

const COMMENT_REPLIES = [
  "Yeah bar 34 has a tempo bump — mine drifts",
  "Moving the crash 1/8 later fixes it, pushing v1.5",
  "Confirmed on my end. Resolving.",
];
const COMMENT_REPLY_AUTHORS = ["ava", "elias", "jules"];

function CommentsDemo() {
  const [count, setCount] = useState(0);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (count >= COMMENT_REPLIES.length) return;
    const text = COMMENT_REPLIES[count];
    let i = 0;
    setTyped("");
    const iv = setInterval(() => {
      i++;
      setTyped(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(iv);
        setTimeout(() => setCount((c) => (c + 1) % (COMMENT_REPLIES.length + 1)), 1400);
      }
    }, 28);
    return () => clearInterval(iv);
  }, [count]);
  const shown = COMMENT_REPLIES.slice(0, count);

  return (
    <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em]">
        <span className="text-muted-foreground">NORTHERN ROOM · GTR-SOLO · v1.4</span>
        <span className="text-lime">COMMENT MODE</span>
      </div>
      <div className="relative p-4 sm:p-5">
        <div className="relative h-14 border-b border-dashed border-[color-mix(in_oklab,var(--border)_80%,transparent)]">
          <Waveform seed={13} bars={72} color="var(--wave-coral)" height={56} />
          <div className="absolute inset-y-0 left-[26%] right-[52%] border-l-2 border-r-2 border-lime bg-[color-mix(in_oklab,var(--lime)_10%,transparent)]">
            <span className="absolute -top-4 left-0 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-lime">
              1:14 → 2:12
            </span>
          </div>
        </div>
        <div className="mt-6 border border-[color-mix(in_oklab,var(--lime)_40%,transparent)] bg-[color-mix(in_oklab,var(--lime)_4%,transparent)] p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2">
            <UserAvatar seed="marek" size={24} kind="user" />
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-foreground">marek</span>
            <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">now</span>
            <span className="ml-auto font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              3 replies
            </span>
          </div>
          <div className="text-[13px] text-foreground">
            This section feels slightly off — anyone else hearing it drift on the second half?
          </div>
          <div className="mt-3 space-y-2 border-l border-[color-mix(in_oklab,var(--border)_80%,transparent)] pl-4">
            {shown.map((r, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                <UserAvatar seed={COMMENT_REPLY_AUTHORS[i]} size={20} kind="user" className="shrink-0" />
                <div className="text-[12px] text-foreground/90">{r}</div>
              </motion.div>
            ))}
            {count < COMMENT_REPLIES.length && (
              <div className="flex items-center gap-2">
                <UserAvatar seed={COMMENT_REPLY_AUTHORS[count]} size={20} kind="user" className="shrink-0" />
                <div className="text-[12px] text-foreground/90">
                  {typed}
                  <span className="tb-caret ml-0.5 inline-block h-3 w-1.5 align-middle bg-lime" />
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] pt-3 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>@mention · attach · link version</span>
            <span className="text-lime">↵ reply</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- 02.2 structure & chords demo --- */

const STRUCTURE_DEMO_CELLS = LANDING_MOCK_SECTIONS.map((s) => ({
  section: s,
  chords: (s.chords ?? "").trim().split(/\s+/).filter(Boolean),
}));
/** Fewer, wider sections for small phones — drops pre-chorus and the repeat chorus so labels don't wrap/cramp. */
const STRUCTURE_DEMO_CELLS_COMPACT = STRUCTURE_DEMO_CELLS.filter(
  (c) => c.section.id !== "s-pre" && c.section.id !== "s-chorus2",
);

function structureDemoTotals(cells: typeof STRUCTURE_DEMO_CELLS) {
  const total = cells.reduce((a, c) => a + c.chords.length, 0);
  let acc = 0;
  let chorus = { start: 0, len: total };
  for (const c of cells) {
    if (c.section.type === "chorus") {
      chorus = { start: acc, len: c.chords.length };
      break;
    }
    acc += c.chords.length;
  }
  return { total, chorus };
}

const STRUCTURE_DEMO_FULL_TOTALS = structureDemoTotals(STRUCTURE_DEMO_CELLS);
const STRUCTURE_DEMO_COMPACT_TOTALS = structureDemoTotals(STRUCTURE_DEMO_CELLS_COMPACT);

function StructureBoard({
  cells,
  total,
  chorus,
}: {
  cells: typeof STRUCTURE_DEMO_CELLS;
  total: number;
  chorus: { start: number; len: number };
}) {
  const [loop, setLoop] = useState(false);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setPos((p) => {
        if (loop) {
          const rel = (p - chorus.start + 1 + chorus.len) % chorus.len;
          return chorus.start + rel;
        }
        return (p + 1) % total;
      });
    }, 600);
    return () => clearInterval(id);
  }, [loop, total, chorus.start, chorus.len]);

  let acc = 0;
  let curSection = 0;
  let curChord = 0;
  for (let i = 0; i < cells.length; i++) {
    if (pos < acc + cells[i].chords.length) {
      curSection = i;
      curChord = pos - acc;
      break;
    }
    acc += cells[i].chords.length;
  }
  return (
    <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[9px] uppercase tracking-[0.14em] sm:text-[10px] sm:tracking-[0.18em]">
        <span className="text-muted-foreground">STRUCTURE · AUTO-DETECTED</span>
        <button
          type="button"
          onClick={() => setLoop((v) => !v)}
          className={`shrink-0 border px-2 py-0.5 transition-colors ${
            loop ? "border-lime bg-[color-mix(in_oklab,var(--lime)_10%,transparent)] text-lime" : "border-border text-foreground"
          }`}
        >
          {loop ? "● LOOPING CHORUS" : "↻ LOOP CHORUS"}
        </button>
      </div>
      <div className="p-2 sm:p-4">
        <div className="flex border border-[color-mix(in_oklab,var(--border)_80%,transparent)]">
          {cells.map((c, i) => (
            <div
              key={c.section.id}
              style={{ flex: c.chords.length }}
              className={`relative min-w-0 border-r border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-1 py-1.5 transition-colors last:border-r-0 sm:px-2 sm:py-2 ${
                curSection === i
                  ? "bg-[color-mix(in_oklab,var(--lime)_15%,transparent)]"
                  : c.section.type === "chorus"
                    ? "bg-[color-mix(in_oklab,var(--lime)_5%,transparent)]"
                    : ""
              }`}
            >
              <div
                className={`tb-section-name truncate font-mono-tb text-[8px] uppercase tracking-[0.1em] sm:text-[9px] sm:tracking-[0.18em] ${
                  curSection === i ? "text-lime" : "text-foreground/70"
                }`}
              >
                {sectionLabel(c.section)}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)]">
          {cells.map((c, i) => (
            <div key={c.section.id} style={{ flex: c.chords.length }} className="flex min-w-0 border-r border-[color-mix(in_oklab,var(--border)_80%,transparent)] last:border-r-0">
              {c.chords.map((chord, j) => {
                const isCurrent = curSection === i && curChord === j;
                return (
                  <div
                    key={j}
                    className={`min-w-0 flex-1 py-1.5 text-center font-mono-tb text-[9px] transition-all sm:py-2 sm:text-[11px] ${
                      isCurrent ? "scale-[1.06] bg-lime text-primary-foreground" : "text-foreground/70"
                    }`}
                  >
                    {chord}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Structure + chord board demo (responsive pair). Exported — reused on /features/structure. */
export function StructureDemo() {
  return (
    <>
      <div className="sm:hidden">
        <StructureBoard
          cells={STRUCTURE_DEMO_CELLS_COMPACT}
          total={STRUCTURE_DEMO_COMPACT_TOTALS.total}
          chorus={STRUCTURE_DEMO_COMPACT_TOTALS.chorus}
        />
      </div>
      <div className="hidden sm:block">
        <StructureBoard
          cells={STRUCTURE_DEMO_CELLS}
          total={STRUCTURE_DEMO_FULL_TOTALS.total}
          chorus={STRUCTURE_DEMO_FULL_TOTALS.chorus}
        />
      </div>
    </>
  );
}

/* --- 02.3 social demo --- */

const SOCIAL_TASKS = [
  { t: "Final vocal take", who: "ava", color: "var(--wave-sky)" },
  { t: "Re-amp bass DI", who: "elias", color: "var(--wave-amber)" },
  { t: "Master pass 1", who: "jules", color: "var(--wave-coral)" },
];

const SOCIAL_MESSAGES: Array<{
  who: string;
  body: ReactNode;
  branch?: string;
  track?: string;
  timecode?: string;
}> = [
  { who: "marek", body: <>Bridge is landing. Listen at 1:42</>, branch: "alt-bridge", track: "gtr-solo", timecode: "1:42" },
  {
    who: "ava",
    body: (
      <>
        <LandingChatMention>@marek</LandingChatMention>
        {" agree — keep the dry gtr, drop the reverb tail"}
      </>
    ),
    track: "gtr-rhythm",
  },
];

const SOCIAL_MEMBERS = [
  { who: "marek", role: "Guitar", color: "var(--lime)" },
  { who: "ava", role: "Vocals", color: "var(--wave-sky)" },
  { who: "elias", role: "Bass", color: "var(--wave-amber)" },
  { who: "jules", role: "Drums", color: "var(--wave-coral)" },
];

function SocialDemo() {
  const [checked, setChecked] = useState<number[]>([0]);
  useEffect(() => {
    const id = setInterval(() => {
      setChecked((c) => (c.length >= SOCIAL_TASKS.length ? [0] : [...c, c.length]));
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid gap-3">
      {/* roadmap */}
      <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4">
        <div className="mb-3 flex items-center justify-between font-mono-tb text-[10px] uppercase tracking-[0.18em]">
          <span className="text-lime">ROADMAP · NORTHERN ROOM</span>
          <span className="text-muted-foreground">STAGE 2 / 3</span>
        </div>
        <div className="space-y-2">
          {SOCIAL_TASKS.map((task, i) => {
            const done = checked.includes(i);
            return (
              <div key={task.t} className="flex items-center gap-3">
                <span
                  className={`grid size-4 place-items-center border text-[10px] transition-colors ${
                    done ? "border-lime bg-lime text-primary-foreground" : "border-border text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className={`text-[12px] ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {task.t}
                </span>
                <UserAvatar seed={task.who} size={20} kind="user" className="ml-auto shrink-0" />
              </div>
            );
          })}
        </div>
      </div>

      {/* chat */}
      <div className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
        <LandingChatChannelTab label="# northern-room" hint="4 members · live" />
        <div className="space-y-3 p-3">
          {SOCIAL_MESSAGES.map((m, i) => (
            <motion.div
              key={m.who}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.2 }}
              className="flex gap-2"
            >
              <UserAvatar seed={m.who} size={28} kind="user" className="shrink-0" />
              <div className="min-w-0">
                <div className="font-mono-tb text-[10px]">
                  <span className="text-lime">@{m.who}</span> <span className="text-muted-foreground">now</span>
                </div>
                <div className="text-[12px] text-foreground">{m.body}</div>
                {(m.branch || m.track || m.timecode) && (
                  <LandingChatLinkBadge branch={m.branch} track={m.track} time={m.timecode} />
                )}
              </div>
            </motion.div>
          ))}
          <div className="flex items-center gap-2">
            <UserAvatar seed="jules" size={28} kind="user" className="shrink-0" />
            <div className="flex items-center gap-1 font-mono-tb text-[10px] text-muted-foreground">
              TYPING
              <span className="tb-typing ml-1 inline-flex gap-0.5">
                <span>·</span>
                <span>·</span>
                <span>·</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* members */}
      <div className="grid grid-cols-4 gap-3 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-3">
        {SOCIAL_MEMBERS.map((m) => (
          <div key={m.who} className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <UserAvatar seed={m.who} size={40} kind="user" />
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-lime" />
            </div>
            <div className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{m.role}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02"
        kicker="FEATURES"
        title="NOT A TOOL."
        accent="A WORKSPACE."
        description="The pieces your band actually uses — comments that stick to bars, a real structure editor, chords in sync with playback, and the social layer that keeps decisions in one place."
        seoNote="Threaded comments on bars, a structure and chord editor, and band chat with a roadmap in one workspace"
      />

      <div className="mt-16 space-y-16 md:space-y-24">
        <FeaturePanel
          side="left"
          eyebrow="02.1 · COMMENTS"
          title="Drop a thought on bar 34."
          copy="Tag a bandmate. Reply in a thread. Every note lives on the exact region it's about — never lost in Slack again."
          chips={["@mentions", "Threaded replies", "Resolve & pin", "Link to version"]}
          demo={<CommentsDemo />}
        />
        <FeaturePanel
          side="right"
          eyebrow="02.2 · STRUCTURE & CHORDS"
          title="Map the song. Know the changes."
          copy="Write the chords — or let us detect them. Loop any section for practice. See the chord that's playing, right now, on every device."
          chips={["Auto chord detect", "Section loop", "Drag to resize", "Synced to playhead"]}
          demo={<StructureDemo />}
        />
        <FeaturePanel
          side="left"
          eyebrow="02.3 · SOCIAL"
          title="Your band lives here too."
          copy="Roadmaps, checklists, chat with mentions and deep-links to any version or track. No context lost between rehearsals."
          chips={["Roadmap & checklist", "@mentions", "Deep-link to bar", "Per-track threads"]}
          demo={<SocialDemo />}
        />
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
        seoNote="Comments on bars, automatic chord detection, song structure tools, and a mobile mixer"
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

/** Phone bezel around a mobile mock. Exported — reused on /features/mobile. */
export function MobilePhoneFrame({ children, accent }: { children: ReactNode; accent: string }) {
  return (
    <div className="relative w-[260px] shrink-0 sm:w-[280px]" style={{ perspective: 1000 }}>
      <div
        className="rounded-[36px] border-2 border-[color-mix(in_oklab,var(--border)_90%,transparent)] bg-background p-2"
        style={{ boxShadow: `0 30px 80px -20px ${accent}22, 0 0 0 1px ${accent}20` }}
      >
        <div className="absolute top-3 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-background" />
        <div className="relative h-[520px] overflow-hidden rounded-[28px] bg-background">{children}</div>
      </div>
    </div>
  );
}

/** Mobile mixer-mode mock. Exported — reused on /features/mobile. */
export function MobileMixerMock() {
  const tracks = [
    { n: "GTR", color: "var(--wave-violet)", seed: 3.2 },
    { n: "DRM", color: "var(--wave-mint)", seed: 5.4 },
    { n: "BAS", color: "var(--wave-amber)", seed: 7.6 },
    { n: "VOX", color: "var(--wave-coral)", seed: 9.1 },
  ];
  return (
    <div className="flex h-full flex-col text-foreground">
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 pb-3 pt-10 font-mono-tb text-[10px] uppercase tracking-[0.18em]">
        <span className="text-muted-foreground">v1.4 · master</span>
        <span className="text-lime">142 BPM</span>
      </div>
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        {tracks.map((t) => (
          <div key={t.n} className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] p-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: t.color }} />
                <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em]">{t.n}</span>
              </div>
              <div className="flex gap-1 font-mono-tb text-[8px]">
                <span className="grid size-4 place-items-center border border-[color-mix(in_oklab,var(--border)_80%,transparent)]">M</span>
                <span className="grid size-4 place-items-center border border-[color-mix(in_oklab,var(--border)_80%,transparent)]">S</span>
              </div>
            </div>
            <div className="relative h-6">
              <div
                aria-hidden
                className="tb-playhead pointer-events-none absolute top-0 bottom-0"
                style={{ width: 1, background: "var(--lime)" }}
              />
              <Waveform seed={t.seed} bars={44} color={t.color} height={24} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-around border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-3">
        <LandingMobileTransportBtn label="Metronome">
          <MetronomeIcon size={16} />
        </LandingMobileTransportBtn>
        <button
          type="button"
          aria-label="Play"
          className="mx-auto grid size-11 place-items-center bg-lime text-primary-foreground transition active:scale-95"
        >
          <LandingMobilePlayIcon />
        </button>
        <button
          type="button"
          aria-label="Record"
          className="mx-auto grid size-9 place-items-center border border-[color-mix(in_oklab,var(--wave-coral)_60%,transparent)] text-[color-mix(in_oklab,var(--wave-coral)_90%,transparent)] transition active:scale-95"
        >
          <span className="tb-rec size-2 rounded-full" style={{ background: "var(--wave-coral)" }} />
        </button>
      </div>
    </div>
  );
}

const MOBILE_REHEARSAL_CHORDS = ["Ebm", "B", "Gb", "Db", "Ebm", "B", "Ab", "Db"];
// Placeholder line-length pattern for the not-yet-built lyrics view (skeleton, not real text).
const LYRICS_SKELETON_WIDTHS = ["72%", "88%", "54%", "94%", "63%", "80%", "46%", "70%"];

/** Mobile rehearsal-mode mock. Exported — reused on /features/mobile. */
export function MobileRehearsalMock() {
  const [chordIdx, setChordIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setChordIdx((c) => (c + 1) % MOBILE_REHEARSAL_CHORDS.length), 900);
    return () => clearInterval(id);
  }, []);
  const chord = MOBILE_REHEARSAL_CHORDS[chordIdx];
  const next = MOBILE_REHEARSAL_CHORDS[(chordIdx + 1) % MOBILE_REHEARSAL_CHORDS.length];
  const bar = chordIdx + 1;

  return (
    <div className="flex h-full flex-col text-foreground">
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 pb-3 pt-10 font-mono-tb text-[10px] uppercase tracking-[0.18em]">
        <span style={{ color: "var(--wave-sky)" }}>● rehearsal</span>
        <span className="text-muted-foreground">rubicon · v1.4</span>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        {["INTRO", "VERSE", "CHORUS", "BRIDGE"].map((s, i) => (
          <span
            key={s}
            className={`border px-2 py-1 font-mono-tb text-[9px] uppercase tracking-[0.18em] ${
              i === 2 ? "border-lime bg-lime text-primary-foreground" : "border-[color-mix(in_oklab,var(--border)_80%,transparent)] text-muted-foreground"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* now / next chord — top half */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6">
          <div className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Now</div>
          <AnimatePresence mode="wait">
            <motion.div
              key={chord + bar}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.25 }}
              className="font-display-tb text-[56px] font-bold leading-none tracking-tight text-lime"
            >
              {chord}
            </motion.div>
          </AnimatePresence>
          <div className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Bar {bar} / 16
          </div>
          <div className="mt-2 flex items-center gap-2 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-1.5">
            <span className="font-mono-tb text-[8px] uppercase tracking-[0.18em] text-muted-foreground">Next</span>
            <span className="font-display-tb text-lg font-bold tracking-tight text-foreground">{next}</span>
          </div>
        </div>

        {/* lyrics — bottom half, teleprompter-style auto-scroll (placeholder skeleton; real lyrics feature not built yet) */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-6 py-3">
          <div className="mb-2 shrink-0 font-mono-tb text-[8px] uppercase tracking-[0.18em] text-muted-foreground">
            Lyrics
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            style={{
              WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
              maskImage: "linear-gradient(to bottom, black 55%, transparent 92%)",
            }}
          >
            <div className="tb-lyrics-scroll absolute inset-x-0 top-0 flex flex-col gap-3">
              {[...LYRICS_SKELETON_WIDTHS, ...LYRICS_SKELETON_WIDTHS].map((w, i) => (
                <div key={i} className="h-2 shrink-0 rounded-full bg-muted-foreground/15" style={{ width: w }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-around border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-3">
        <LandingMobileTransportBtn label="Metronome">
          <MetronomeIcon size={16} />
        </LandingMobileTransportBtn>
        <button
          type="button"
          aria-label="Play"
          className="mx-auto grid size-11 place-items-center bg-lime text-primary-foreground transition active:scale-95"
        >
          <LandingMobilePlayIcon />
        </button>
        <LandingMobileTransportBtn label="Loop">
          <LandingMobileLoopIcon size={16} />
        </LandingMobileTransportBtn>
      </div>
    </div>
  );
}

const MOBILE_COMPARISON_ROWS: Array<[string, boolean, boolean, boolean]> = [
  ["Versions & diff", true, true, false],
  ["Multitrack mixer", true, true, false],
  ["Record via mic", true, true, false],
  ["Comment on bars", true, true, false],
  ["Structure editor", true, true, true],
  ["Chord chart", true, true, true],
  ["Section loop", true, true, true],
  ["Metronome", true, true, true],
];

/** Desktop vs mobile capability table. Exported — reused on /features/mobile. */
export function MobileComparisonTable({ className = "" }: { className?: string }) {
  return (
    <div className={`border border-[color-mix(in_oklab,var(--border)_80%,transparent)] ${className}`}>
      <table className="w-full table-fixed font-mono-tb text-[9px] sm:text-[11px]">
        <thead>
          <tr className="border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] uppercase tracking-[0.1em] text-muted-foreground sm:tracking-[0.18em]">
            <th className="w-[34%] px-1.5 py-2 text-left font-normal sm:w-auto sm:px-4 sm:py-3">Capability</th>
            <th className="px-1 py-2 text-center font-normal sm:px-4 sm:py-3">Desktop</th>
            <th className="px-1 py-2 text-center font-normal text-lime sm:px-4 sm:py-3">
              <span className="sm:hidden">Mixer</span>
              <span className="hidden sm:inline">Mobile · Mixer</span>
            </th>
            <th className="px-1 py-2 text-center font-normal sm:px-4 sm:py-3" style={{ color: "var(--wave-sky)" }}>
              <span className="sm:hidden">Rehearsal</span>
              <span className="hidden sm:inline">Mobile · Rehearsal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {MOBILE_COMPARISON_ROWS.map(([label, desktop, mixer, rehearsal], i) => (
            <tr key={i} className="border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] last:border-b-0 hover:bg-[color-mix(in_oklab,var(--card)_30%,transparent)]">
              <td className="truncate px-1.5 py-2 uppercase tracking-[0.1em] text-foreground sm:px-4 sm:py-2.5 sm:tracking-[0.18em]">
                {label}
              </td>
              {[desktop, mixer, rehearsal].map((v, j) => (
                <td key={j} className={`px-1 py-2 text-center sm:px-4 sm:py-2.5 ${v ? "text-lime" : "text-muted-foreground/40"}`}>
                  {v ? "✓" : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileSection() {
  return (
    <section id="mobile" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="03"
        kicker="MOBILE"
        title="MOBILE VERSION IS"
        accent="YOUR COMPANION."
        description="Same engine as desktop, two modes built for how bands actually work — refining on the couch, rehearsing in the room. It's a second product, not a downgrade."
        seoNote="Mobile mixer mode and rehearsal mode apps for bands, with the same engine as desktop"
      />

      <div className="mt-14 grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center"
        >
          <MobilePhoneFrame accent="var(--lime)">
            <MobileMixerMock />
          </MobilePhoneFrame>
          <div className="mt-6 max-w-xs text-center">
            <div className="font-display-tb text-xl font-bold tracking-tight text-lime">Mixer mode</div>
            <p className="mt-2 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
              Refine a version, record a new idea with the built-in mic, comment on the fly.
            </p>
          </div>
        </motion.div>

        <div className="hidden flex-col items-center gap-4 self-center lg:flex">
          <div className="h-24 w-px bg-[color-mix(in_oklab,var(--border)_80%,transparent)]" />
          <div className="rotate-90 whitespace-nowrap font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
            Two modes · one project
          </div>
          <div className="h-24 w-px bg-[color-mix(in_oklab,var(--border)_80%,transparent)]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="flex flex-col items-center"
        >
          <MobilePhoneFrame accent="var(--wave-sky)">
            <MobileRehearsalMock />
          </MobilePhoneFrame>
          <div className="mt-6 max-w-xs text-center">
            <div className="font-display-tb text-xl font-bold tracking-tight" style={{ color: "var(--wave-sky)" }}>
              Rehearsal mode
            </div>
            <p className="mt-2 font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
              No laptop. No DAW. Just structure, chords, and a metronome you can trust.
            </p>
          </div>
        </motion.div>
      </div>

      <MobileComparisonTable className="mt-16" />

      <div className="mt-8 border-l-2 border-lime pl-4 sm:pl-6">
        <div className="font-display-tb text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Your studio in your pocket. <span className="text-lime">It never lets you down.</span>
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
        index="05"
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
                className="tb-no-press-scale flex w-full items-center justify-between gap-3 p-4 text-left"
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
        description="sonicdesk is built in public. Private beta is live now; every following release unlocks a new room in the studio."
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
 * FAQ — sticky intro + tag-filterable, single-open accordion.
 * The left column stays pinned (`lg:sticky lg:top-24`) while the right-hand
 * question list scrolls past it — that's the section's "scroll behavior".
 * ============================================================ */

const FAQ_TAGS = ["all", "basics", "solo", "pricing", "versioning", "files", "security", "mobile"] as const;
type FaqTag = (typeof FAQ_TAGS)[number];

function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [filter, setFilter] = useState<FaqTag>("all");

  const filtered = useMemo(
    () =>
      SEO_FAQS.map((item, i) => ({ ...item, i })).filter(
        (item) => filter === "all" || item.tag === filter,
      ),
    [filter],
  );

  return (
    <section id="faq" className="relative landing-section-border px-4 py-20 md:px-8 md:py-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <MonoLabel>
            <span className="text-lime">08</span> · FAQ
          </MonoLabel>
          <h2 className="mt-6 font-display-tb text-[2.6rem] font-bold leading-[0.95] tracking-[-0.02em] text-foreground md:text-[3.75rem]">
            QUESTIONS, <span className="text-lime">ANSWERED.</span>
          </h2>
          <p className="mt-6 max-w-md font-mono-tb text-sm leading-relaxed text-muted-foreground">
            The things people actually ask before they upload their first track. Still unsure?{" "}
            <a href="mailto:hi@sonicdesk.studio" className="text-lime underline-offset-4 hover:underline">
              hi@sonicdesk.studio
            </a>
            .
          </p>

          <div className="mt-8 flex flex-wrap gap-1.5">
            {FAQ_TAGS.map((tag) => {
              const active = filter === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setFilter(tag);
                    setOpenIdx(null);
                  }}
                  className={`tb-no-press-scale border px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    active
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-[color-mix(in_oklab,var(--border)_80%,transparent)] text-muted-foreground hover:border-lime hover:text-lime"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map(({ question, answer, tag, i }, idx) => {
              const isOpen = openIdx === i;
              return (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, delay: idx * 0.03 }}
                  className="group border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)]"
                >
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    className="tb-no-press-scale relative flex w-full cursor-pointer items-start gap-4 py-5 text-left sm:gap-6 sm:py-6"
                  >
                    <span className="w-8 shrink-0 pt-1.5 font-mono-tb text-[10px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-1 flex items-center gap-2">
                        <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-lime">
                          / {tag}
                        </span>
                      </span>
                      <span
                        className={`block font-display-tb text-[clamp(1.2rem,2.6vw,1.9rem)] font-bold leading-[1.05] tracking-tight transition-colors ${
                          isOpen ? "text-foreground" : "text-foreground/85 group-hover:text-lime"
                        }`}
                      >
                        {question}
                      </span>
                    </span>
                    <motion.span
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20 }}
                      aria-hidden
                      className={`mt-1.5 grid size-8 shrink-0 place-items-center border font-mono-tb text-lg leading-none sm:size-10 ${
                        isOpen
                          ? "border-lime text-lime"
                          : "border-[color-mix(in_oklab,var(--border)_60%,transparent)] text-muted-foreground group-hover:border-lime group-hover:text-lime"
                      }`}
                    >
                      +
                    </motion.span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={`faq-panel-${i}`}
                        key="panel"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ height: { duration: 0.35, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 0.25 } }}
                        className="overflow-hidden"
                      >
                        <div className="-mt-1 pb-6 pl-12 pr-4 sm:pb-7 sm:pl-14 sm:pr-14">
                          <motion.p
                            initial={{ y: 8, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 4, opacity: 0 }}
                            transition={{ duration: 0.3, delay: 0.05 }}
                            className="max-w-2xl font-mono-tb text-[13px] leading-relaxed text-muted-foreground"
                          >
                            {answer}
                          </motion.p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {filtered.length === 0 && (
            <div className="py-10 font-mono-tb text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Nothing here yet — try another tag.
            </div>
          )}
        </div>
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
          Bring your band, your roster, your class. sonicdesk is free during beta — every workspace
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
        <div className="grid gap-8 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)] p-6 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div>
          <div
            className="font-display-tb font-bold tracking-tight text-lime text-xl"

          >
            sonicdesk
          </div>
          <p className="mt-3 max-w-sm font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Music is a process. Not a file.
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
            "DEEP DIVES",
            [
              { label: "Versions & A/B", href: "/features/versions" },
              { label: "Comments on bars", href: "/features/comments" },
              { label: "Structure & chords", href: "/features/structure" },
              { label: "Mobile", href: "/features/mobile" },
              { label: "Free chord detector", href: "/tools/chord-detector" },
              { label: "For cover bands", href: "/audience/cover-band" },
              { label: "For indie bands", href: "/audience/indie-band" },
              { label: "For producers", href: "/audience/producer" },
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
            sonicdesk <span className="text-foreground">// v0.1</span> · © 2026
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
          <Features />
          <MobileSection />
          <Philosophy />
          <ThemingSection />
          <FeatureIndex />
          <Roadmap />
          <FAQ />
          <CTA signInHref={authHref} />
          <Footer />
        </main>
      </div>
    </div>
  );
}
