"use client";

/**
 * Shared shell for the legal documents (/terms, /privacy, /refund).
 * Ported 1:1 from sonicdesk_designs/src/routes/{terms,privacy,refund}.tsx:
 * read-progress bar, sticky header, hero, section index (sticky sidebar on
 * desktop, collapsible <details> on mobile) and a footer linking the other
 * documents + cookie settings.
 *
 * Copy lives in the per-document components (TermsDocument etc.) and is taken
 * verbatim from the designs — edit it there, not here.
 */

import "./legal.css";
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { TopBar } from "@/components/LandingPage";
import { useLandingAuth } from "@/hooks/useLandingAuth";

export type LegalDocKey = "terms" | "privacy" | "refund";

export const LEGAL_DOCS: Record<LegalDocKey, { href: string; label: string; number: string }> = {
  terms: { href: "/terms", label: "Terms of Service", number: "01" },
  privacy: { href: "/privacy", label: "Privacy Policy", number: "02" },
  refund: { href: "/refund", label: "Refund Policy", number: "03" },
};

/**
 * "Last updated" shown on each document. Bump the matching date whenever that
 * document's copy changes (the Privacy Policy promises the date is accurate).
 *
 * ⚠ `terms` has a DB twin: the version recorded on sign-up is
 * `public.current_terms_version()` (supabase/migrations/20260923_terms_acceptance.sql,
 * ISO date). When the Terms change, bump both.
 */
export const LEGAL_LAST_UPDATED: Record<LegalDocKey, string> = {
  terms: "23 September 2026",
  privacy: "23 September 2026",
  refund: "23 September 2026",
};


export function LegalDocument({
  doc,
  tag,
  titleLead,
  titleAccent,
  intro,
  sections,
  children,
}: {
  doc: LegalDocKey;
  /** Hero chip, e.g. "Document · Privacy". */
  tag: string;
  titleLead: string;
  titleAccent: string;
  /** Optional lead paragraph(s) under the title. */
  intro?: ReactNode;
  sections: ReadonlyArray<readonly [id: string, label: string]>;
  children: ReactNode;
}) {
  const meta = LEGAL_DOCS[doc];
  const { authHref, authLabel } = useLandingAuth();
  const [activeSection, setActiveSection] = useState<string>(sections[0][0]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(documentHeight > 0 ? Math.min(100, (window.scrollY / documentHeight) * 100) : 0);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first?.target.id) setActiveSection(first.target.id);
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: 0 },
    );

    sections.forEach(([id]) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections]);

  const otherDocs = (Object.keys(LEGAL_DOCS) as LegalDocKey[]).filter((k) => k !== doc);
  const navLabel = `${meta.label} sections`;

  return (
    <div className="landing-page legal-page min-h-screen" data-theme="lime">
      <main className="min-h-screen bg-background text-foreground">
        <div className="fixed inset-x-0 top-0 z-[60] h-0.5 bg-[var(--surface-2)]" aria-hidden="true">
          <div className="h-full bg-lime transition-[width] duration-150" style={{ width: `${progress}%` }} />
        </div>

        {/* Same header as the main landing (nav anchors resolve to "/#…" off-home). */}
        <TopBar authHref={authHref} authLabel={authLabel} />

        <div className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10">
          <section className="relative border-x border-border px-5 pb-14 pt-16 sm:px-10 sm:pb-20 sm:pt-24 lg:px-14">
            <div className="legal-dotgrid pointer-events-none absolute inset-0 opacity-40" />
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <div className="mb-7 flex flex-wrap items-center gap-3 font-mono-tb text-[10px] uppercase tracking-widest text-[var(--lg-muted)]">
                <span className="border border-border bg-[var(--surface)] px-2.5 py-1.5 text-lime">{tag}</span>
                <span>Last updated: {LEGAL_LAST_UPDATED[doc]}</span>
              </div>
              <h1 className="max-w-5xl font-display-tb text-[clamp(3.5rem,10vw,9rem)] font-bold leading-[0.82] tracking-normal">
                {titleLead} <span className="text-lime">{titleAccent}</span>
              </h1>
              {intro ? (
                <div className="legal-copy mt-8 max-w-3xl border-l-2 border-lime pl-5 font-body-tb text-lg leading-8 text-[var(--lg-muted-strong)] sm:text-xl">
                  {intro}
                </div>
              ) : null}
            </motion.div>
          </section>

          <details className="border-x border-t border-border bg-[var(--surface)] lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-mono-tb text-[10px] uppercase tracking-widest text-[var(--lg-muted-strong)]">
              <span>Section index · {sections.length}</span>
              <span className="text-lime">Open +</span>
            </summary>
            <nav aria-label={navLabel} className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
              {sections.map(([id, label], index) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="flex gap-3 bg-background px-5 py-3 font-mono-tb text-[10px] uppercase tracking-widest text-[var(--lg-muted)] transition-colors hover:text-lime"
                >
                  <span className="text-lime">{String(index + 1).padStart(2, "0")}</span>
                  <span>{label}</span>
                </a>
              ))}
            </nav>
          </details>

          <div className="grid border-x border-t border-border lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="hidden border-r border-border lg:block">
              <div className="sticky top-24 px-7 py-10">
                <p className="mb-6 font-mono-tb text-[10px] uppercase tracking-[0.3em] text-[var(--lg-muted)]">
                  Section index
                </p>
                <nav aria-label={navLabel} className="space-y-0.5">
                  {sections.map(([id, label], index) => {
                    const active = activeSection === id;
                    return (
                      <a
                        key={id}
                        href={`#${id}`}
                        aria-current={active ? "location" : undefined}
                        className={`group grid grid-cols-[26px_1fr] gap-2 border-l py-2 pl-3 font-mono-tb text-[10px] uppercase tracking-widest transition-colors ${
                          active
                            ? "border-lime text-foreground"
                            : "border-transparent text-[var(--lg-muted)] hover:border-[var(--lg-border-strong)] hover:text-[var(--lg-muted-strong)]"
                        }`}
                      >
                        <span className={active ? "text-lime" : "text-[var(--lg-muted)]"}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="leading-4">{label}</span>
                      </a>
                    );
                  })}
                </nav>
                <div className="mt-9 border-t border-border pt-5">
                  <div className="mb-2 flex items-center justify-between font-mono-tb text-[9px] uppercase tracking-widest text-[var(--lg-muted)]">
                    <span>Read progress</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-px bg-border">
                    <div className="h-full bg-lime transition-[width] duration-150" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </div>
            </aside>

            <article className="min-w-0 px-5 py-8 sm:px-10 sm:py-14 lg:px-16 xl:px-24">{children}</article>
          </div>

          <footer className="border-x border-t border-border px-5 py-8 sm:px-10">
            <div className="flex flex-wrap items-center justify-between gap-4 font-mono-tb text-[10px] uppercase tracking-widest text-[var(--lg-muted)]">
              <span>
                {meta.label} · {sections.length} sections
              </span>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {otherDocs.map((k) => (
                  <Link key={k} href={LEGAL_DOCS[k].href} className="hover:text-lime">
                    {LEGAL_DOCS[k].label}
                  </Link>
                ))}
                <CookieSettingsLink className="uppercase tracking-widest hover:text-lime" />
                <Link href="/" className="text-lime hover:underline hover:underline-offset-4">
                  ← Back to sonicdesk.
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

export function LegalSection({
  number,
  id,
  title,
  children,
  featured = false,
  warning = false,
}: {
  number: string;
  id: string;
  title: string;
  children: ReactNode;
  featured?: boolean;
  warning?: boolean;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.45 }}
      className={`scroll-mt-28 border-b border-border py-12 first:pt-4 sm:py-16 ${featured || warning ? "relative" : ""}`}
    >
      {featured && (
        <div className="absolute -left-5 top-12 bottom-12 w-0.5 bg-lime sm:-left-10 lg:-left-16" aria-hidden="true" />
      )}
      {warning && <div className="absolute left-0 right-0 top-0 h-px bg-destructive" aria-hidden="true" />}
      <div className="mb-7 grid grid-cols-[42px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[58px_minmax(0,1fr)] sm:gap-5">
        <span className={`pt-1 font-mono-tb text-[11px] tracking-widest ${warning ? "text-destructive" : "text-lime"}`}>
          {number}
        </span>
        <h2 className="font-display-tb text-[clamp(1.7rem,4vw,3rem)] font-bold leading-none tracking-normal">
          {title}
        </h2>
      </div>
      <div className="legal-copy ml-[55px] space-y-5 font-body-tb text-[16px] leading-8 text-[var(--lg-muted-strong)] sm:ml-[78px] sm:text-[17px]">
        {children}
      </div>
    </motion.section>
  );
}

export function LegalTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full min-w-[560px] border-collapse text-left text-[15px] leading-7">
        <thead>
          <tr className="border-b border-border bg-[var(--surface)]">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-4 py-3 font-mono-tb text-[10px] font-normal uppercase tracking-widest text-lime"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-4 py-3 align-top ${cellIndex === 0 ? "font-semibold text-foreground" : "text-[var(--lg-muted-strong)]"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
