"use client";

/**
 * Shared chrome for the marketing "slice" pages (/features/*, /audience/*).
 *
 * These pages tell one story each — a single feature or a single audience —
 * so they get a slimmer nav + a persistent "this is one slice of the full
 * workspace" banner instead of the full landing TopBar/Footer.
 * Styling mirrors components/LandingPage.tsx (lime theme, font-*-tb, mono labels).
 */

import Link from "next/link";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useLandingAuth } from "@/hooks/useLandingAuth";

export type SliceKind = "feature" | "audience";

/* ============================================================
 * Page wrapper — applies the landing theme scope
 * ============================================================ */

export function SlicePage({ children }: { children: ReactNode }) {
  return (
    <div className="landing-page min-h-screen" data-theme="lime">
      <div className="mx-auto w-full max-w-[1920px]">
        <main className="min-h-screen bg-background text-foreground">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ============================================================
 * Slim top nav
 * ============================================================ */

export function SliceNav({ kind, label }: { kind: SliceKind; label: string }) {
  const { authHref } = useLandingAuth();

  return (
    <nav className="landing-full-bleed sticky top-0 z-40 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_95%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1920px] items-center justify-between gap-4 px-4 md:px-8">
        <Link href="/" className="flex min-w-0 items-baseline gap-2 text-foreground">
          <span className="font-display-tb text-base font-bold tracking-tight text-lime sm:text-lg">
            sonicdesk.
          </span>
          <span className="hidden font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
            // {kind} · {label}
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/"
            className="hidden items-center border border-border px-3 py-1.5 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)] hover:text-lime sm:inline-flex"
          >
            ← Full product
          </Link>
          <Link
            href={authHref}
            className="tb-btn-accent inline-flex items-center bg-lime px-3 py-1.5 text-[10px] uppercase text-primary-foreground transition-colors"
          >
            Dashboard →
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ============================================================
 * Scope banner — "you're viewing one slice"
 * ============================================================ */

export function ScopeBanner({ kind, children }: { kind: SliceKind; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="landing-full-bleed border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--lime)_6%,transparent)]"
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-2.5 font-mono-tb text-[10px] uppercase tracking-[0.18em] sm:px-6">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-lime tb-blink" />
          <span className="truncate">
            {kind === "feature"
              ? "You're viewing one feature — sonicdesk. is a full workspace"
              : "You're viewing a slice — sonicdesk. is a full workspace for every band"}
            . {children}
          </span>
        </span>
        <Link href="/" className="shrink-0 text-lime underline-offset-4 hover:underline">
          See full product →
        </Link>
      </div>
    </motion.div>
  );
}

/* ============================================================
 * Hero
 * ============================================================ */

export function SliceHero({
  pill,
  title,
  children,
}: {
  pill: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative px-4 pt-14 pb-12 sm:px-6 sm:pt-20">
      <div aria-hidden className="tb-grid-bg-landing pointer-events-none absolute inset-0 landing-abs-bleed" />
      <div className="relative mx-auto w-full max-w-[1400px]">
        <SlicePill>{pill}</SlicePill>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9 }}
          className="mt-6 font-display-tb text-[clamp(3rem,11vw,9rem)] font-bold leading-[0.85] tracking-[-0.045em] text-balance"
        >
          {title}
        </motion.h1>
        <SliceMono className="mt-6 max-w-2xl">{children}</SliceMono>
      </div>
    </section>
  );
}

/* ============================================================
 * Section + typography primitives
 * ============================================================ */

export function SliceSection({
  id,
  index,
  tag,
  children,
}: {
  id?: string;
  index: string;
  tag: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="relative border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-8 flex items-baseline gap-4 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:mb-10">
          <span className="text-lime">{index}</span>
          <span className="h-px flex-1 bg-[color-mix(in_oklab,var(--border)_80%,transparent)]" />
          <span>{tag}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

export function SliceHeadline({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display-tb text-[clamp(2.4rem,7vw,5.5rem)] font-bold leading-[0.9] tracking-[-0.02em] text-balance">
      {children}
    </h2>
  );
}

export function SliceMono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono-tb text-[12px] leading-relaxed text-muted-foreground ${className}`}>
      {children}
    </p>
  );
}

export function SlicePill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 border border-[color-mix(in_oklab,var(--lime)_60%,transparent)] px-2.5 py-1 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-lime">
      <span className="size-1.5 bg-lime tb-blink" />
      {children}
    </span>
  );
}

/* ============================================================
 * Card grid — the "how sonicdesk. fixes it" blocks
 * ============================================================ */

export type SliceCardItem = {
  title: string;
  desc: string;
  /** Optional deep-dive link to another slice page (or a landing anchor). */
  href?: string;
};

export function SliceCardGrid({
  items,
  className = "md:grid-cols-2 lg:grid-cols-3",
  titleClassName = "text-2xl",
  delayStep = 0.05,
}: {
  items: SliceCardItem[];
  className?: string;
  titleClassName?: string;
  delayStep?: number;
}) {
  return (
    <div className={`mt-10 grid gap-4 ${className}`}>
      {items.map((item, i) => (
        <motion.div
          key={item.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * delayStep }}
          className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-5 transition-colors hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)]"
        >
          <div className={`font-display-tb font-bold tracking-tight ${titleClassName}`}>{item.title}</div>
          <div className="mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">{item.desc}</div>
          {item.href && (
            <Link
              href={item.href}
              className="mt-3 inline-block font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime underline-offset-4 hover:underline"
            >
              Deep-dive →
            </Link>
          )}
        </motion.div>
      ))}
    </div>
  );
}

/* ============================================================
 * Footer — big "see the whole workspace" CTA + slim bar
 * ============================================================ */

export function SliceFooter({ kind, label }: { kind: SliceKind; label: string }) {
  const { authHref } = useLandingAuth();

  return (
    <>
      <section className="relative border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-20 sm:px-6 sm:py-28">
        <div aria-hidden className="tb-grid-bg-landing pointer-events-none absolute inset-0 landing-abs-bleed opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 landing-abs-bleed"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--lime) 14%, transparent), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-[1100px] text-center">
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
            {kind === "feature" ? "This is one piece · " : "This is one story · "}
            <span className="text-lime">{label}</span>
          </span>
          <h2 className="mt-4 font-display-tb text-[clamp(2.2rem,7vw,5.5rem)] font-bold leading-[0.9] tracking-[-0.02em] text-balance">
            SEE THE WHOLE <span className="text-lime">WORKSPACE.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl font-mono-tb text-[12px] leading-relaxed text-muted-foreground">
            Versioning · A/B compare · comments on bars · structure & chords · mobile mixer ·
            rehearsal mode · resources · chat — one place, one truth.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="tb-btn-accent inline-flex items-center bg-lime px-6 py-3 text-[11px] uppercase text-primary-foreground"
            >
              Open sonicdesk. landing →
            </Link>
            <Link
              href={authHref}
              className="inline-flex items-center border border-border px-4 py-3 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)] hover:text-lime"
            >
              Try the app
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-4 py-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>© sonicdesk. · v0.1 · built for musicians</span>
          <Link href="/" className="text-lime underline-offset-4 hover:underline">
            ← Back to landing
          </Link>
        </div>
      </footer>
    </>
  );
}
