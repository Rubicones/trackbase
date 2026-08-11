"use client";

import { useEffect, useRef, useState } from "react";
import {
  VersionGraphLabel,
  vgu,
  VG_DURATION,
  VG_B1,
  VG_B2,
  VG_B3,
} from "@/components/LandingPage";

/* ============================================================
 * Hero version graph — fluid-width variant (/simple only)
 * ============================================================
 *
 * Same artwork as `HeroVersionGraph`, drawn to fill a panel of any width.
 *
 * WHY THIS EXISTS. The shared `HeroVersionGraph` paints a fixed 1080×560
 * viewBox with `preserveAspectRatio="none"` into a stage locked to that ratio.
 * Give that stage a wider box at the same height and the SVG does not get
 * longer, it gets *stretched*: the branch dots flatten into ellipses, the
 * near-horizontal curve shoulders alias into visible steps, and the stroke
 * weights go anisotropic. There is no CSS fix — the distortion is the renderer
 * faithfully doing what a non-uniform viewBox mapping asks for.
 *
 * HOW THIS FIXES IT. The geometry below is parametric instead of literal. The
 * stage is measured, the viewBox is set to its exact pixel size, and every
 * coordinate is computed from that — so the mapping is 1:1 and nothing is
 * scaled non-uniformly. Circles stay circles at any width and the curves
 * rasterise at their true slope.
 *
 * WHAT STAYS FIXED AS THE PANEL GROWS. Vertical geometry, stroke weights, dot
 * radii and the S-curve shoulders are all pinned to the design's own pixel
 * sizes; only the straight runs between them absorb the extra width. That is
 * the "wider, not bigger" behaviour the layout wants: at 1856px the master line
 * and branch straights are simply longer, drawn with the same pen.
 *
 * FIDELITY. The parametric form reproduces the promo design file exactly at its
 * native 1080×560 — every anchor, control point and label position below
 * resolves to the literal number in `HeroVersionGraph` when width is 1080 (the
 * assertions are in the comments beside each path). Below 1080 the whole
 * drawing scales down uniformly, which is what the original did too. So this is
 * a strict generalisation of the shared component, not a redesign, and the same
 * rule from AGENTS.md §4 applies: geometry and keyframe percentages must stay in
 * sync with "Promo - Stop Losing Track Versions", feature card 4a.
 *
 * The `vg-*` keyframes are reused untouched — they animate `stroke-dashoffset`
 * against `pathLength="100"`, so they are independent of actual path length.
 */

/** The promo design file's canvas. All ratios below are expressed against it. */
const VG_W = 1080;
const VG_H = 560;

/** X anchors as fractions of the design canvas, so they track the panel width. */
const F = {
  masterStart: 40 / VG_W,
  masterEnd: 1040 / VG_W,
  b1Start: 140 / VG_W,
  b1Tip: 500 / VG_W,
  b2Start: 280 / VG_W,
  b2Merge: 820 / VG_W,
  b3Start: 560 / VG_W,
  b3Merge: 1020 / VG_W,
};

type Geometry = ReturnType<typeof buildGeometry>;

/**
 * @param w Stage width in CSS pixels.
 * @param h Stage height in CSS pixels (capped at 560 by `.tb-vg-stage-fluid`).
 */
function buildGeometry(w: number, h: number) {
  // Uniform scale, driven by width alone: 1:1 at or past the native canvas,
  // proportional below it (which is what the original component did).
  const s = Math.min(1, w / VG_W);

  // Vertical placement is anchored to the master line at the box's centre
  // rather than to the top edge, so the drawing stays centred in a stage of
  // ANY height. That is what lets the stage be cropped to a tighter band than
  // the design's 560px canvas — most of which is empty above and below the
  // artwork — without the geometry needing to know the crop.
  //
  // The identity worth keeping in mind: at a 560-unit-tall box this resolves to
  // the design's own coordinates exactly (label offsets land on 26% / 74%, the
  // MASTER badge on 55.357%), so cropping is purely a framing decision and can
  // be changed in CSS alone. See `.tb-vg-stage-fluid` in app/globals.css.
  const yFor = (designY: number) => h / 2 + (designY - 280) * s;

  const yMid = yFor(280);
  const yUp = yFor(210);
  const yDown = yFor(350);

  // Constant-size drawing units. These do NOT grow with the panel.
  const stroke = 5 * s;
  const rDot = 6 * s;
  const rMerge = 8 * s;
  const shoulder = 100 * s; // cubic control offset
  const span = 200 * s; // full horizontal reach of an S-curve
  const mergeSpan = 160 * s; // B3's shorter merge curve (design asymmetry)

  const x = (f: number) => f * w;

  const mStart = x(F.masterStart);
  const mEnd = x(F.masterEnd);
  const b1 = x(F.b1Start);
  const b1Tip = x(F.b1Tip);
  const b2 = x(F.b2Start);
  const b2Merge = x(F.b2Merge);
  const b3 = x(F.b3Start);
  const b3Merge = x(F.b3Merge);

  // Straight-run start/end per branch — also where each label is centred.
  const b1StraightFrom = b1 + span; //           1080 → 340 ✓
  const b2StraightFrom = b2 + span; //           1080 → 480 ✓
  const b2StraightTo = b2Merge - span; //        1080 → 620 ✓
  const b3StraightFrom = b3 + span; //           1080 → 760 ✓
  const b3StraightTo = b3Merge - mergeSpan; //   1080 → 860 ✓

  return {
    s,
    stroke,
    rDot,
    rMerge,
    yMid,
    yUp,
    mEnd,
    // master: 40,280 → 1040,280
    master: `M ${mStart} ${yMid} L ${mEnd} ${yMid}`,
    // B1 · darker-mix — up and dead-ends.
    // 1080 → "M 140 280 C 240 280, 240 210, 340 210 L 500 210" ✓
    b1: `M ${b1} ${yMid} C ${b1 + shoulder} ${yMid}, ${b1 + shoulder} ${yUp}, ${b1StraightFrom} ${yUp} L ${b1Tip} ${yUp}`,
    b1From: [b1, yMid] as const,
    b1TipAt: [b1Tip, yUp] as const,
    // B2 · alt-bridge — down and merges back.
    // 1080 → "M 280 280 C 380 280, 380 350, 480 350 L 620 350 C 720 350, 720 280, 820 280" ✓
    b2: `M ${b2} ${yMid} C ${b2 + shoulder} ${yMid}, ${b2 + shoulder} ${yDown}, ${b2StraightFrom} ${yDown} L ${b2StraightTo} ${yDown} C ${b2StraightTo + shoulder} ${yDown}, ${b2Merge - shoulder} ${yMid}, ${b2Merge} ${yMid}`,
    b2From: [b2, yMid] as const,
    b2MergeAt: [b2Merge, yMid] as const,
    // B3 · polishing — up and merges back.
    // 1080 → "M 560 280 C 660 280, 660 210, 760 210 L 860 210 C 960 210, 960 280, 1020 280" ✓
    b3: `M ${b3} ${yMid} C ${b3 + shoulder} ${yMid}, ${b3 + shoulder} ${yUp}, ${b3StraightFrom} ${yUp} L ${b3StraightTo} ${yUp} C ${b3StraightTo + shoulder} ${yUp}, ${b3StraightTo + shoulder} ${yMid}, ${b3Merge} ${yMid}`,
    b3From: [b3, yMid] as const,
    b3MergeAt: [b3Merge, yMid] as const,
    // Labels sit at the midpoint of their branch's straight run — which at the
    // native canvas is the design's own 38.9% / 50.9% / 75%.
    label1Left: `${(((b1StraightFrom + b1Tip) / 2) / w) * 100}%`,
    label2Left: `${(((b2StraightFrom + b2StraightTo) / 2) / w) * 100}%`,
    label3Left: `${(((b3StraightFrom + b3StraightTo) / 2) / w) * 100}%`,
    // Label rows, as a share of the box height. Design centres are 145.6 (the
    // two upper labels) and 414.4 (the lower one) — ±134.4 either side of the
    // master line. At a 560-unit box these come out as the original 26% / 74%.
    labelTopUpper: `${(yFor(145.6) / h) * 100}%`,
    labelTopLower: `${(yFor(414.4) / h) * 100}%`,
    /** MASTER badge — design 60px from the left edge and 30px below master. */
    masterLeft: `${60 * s}px`,
    masterTop: `${(yFor(310) / h) * 100}%`,
    viewBox: `0 0 ${w} ${h}`,
  };
}

/** One animated branch dot. `transform-origin` has to follow the coordinate. */
function VgDot({
  at,
  r,
  fill,
  anim,
}: {
  at: readonly [number, number];
  r: number;
  fill: string;
  anim: string;
}) {
  const [cx, cy] = at;
  return (
    <circle
      className="tb-vg-anim"
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      style={{
        opacity: 0,
        transformOrigin: `${cx}px ${cy}px`,
        animation: `${anim} ${VG_DURATION} linear infinite`,
      }}
    />
  );
}

export function HeroVersionGraphFluid() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);

  // The viewBox has to equal the stage's real pixel box for the mapping to be
  // 1:1, so the box is measured rather than assumed. ResizeObserver rather than
  // a window listener: the panel's width also changes when the scrollbar
  // appears or the container reflows, with no resize event.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setGeo(buildGeometry(width, height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative overflow-hidden border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)]">
      {/* meta strip */}
      <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] sm:px-4">
        <span className="truncate text-muted-foreground">
          /03 · <span className="text-foreground">sonicdesk</span> · 3 versions · 2 merged
        </span>
        <span className="shrink-0 text-lime">VERSIONS · 3</span>
      </div>

      {/* Stage. Keeps `.tb-vg-stage`'s container + label scaling; the `-fluid`
          modifier caps the height at the design's 560px so extra width becomes
          length rather than size. Sized entirely in CSS, so there is no layout
          shift while the measurement resolves. */}
      <div ref={stageRef} className="tb-vg-stage tb-vg-stage-fluid relative w-full">
        <div className="absolute inset-0">
          {geo && (
            <svg
              viewBox={geo.viewBox}
              width="100%"
              height="100%"
              className="absolute inset-0"
              aria-hidden
            >
              {/* master */}
              <path
                className="tb-vg-anim"
                d={geo.master}
                fill="none"
                stroke="var(--lime)"
                strokeWidth={geo.stroke}
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset="100"
                style={{ animation: `vg-master ${VG_DURATION} linear infinite` }}
              />
              <circle cx={geo.mEnd} cy={geo.yMid} r={geo.rMerge} fill="var(--lime)" />

              {/* B1 · darker-mix — branches up, dead-ends */}
              <path
                className="tb-vg-anim"
                d={geo.b1}
                fill="none"
                stroke={VG_B1}
                strokeWidth={geo.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset="100"
                style={{ animation: `vg-b1 ${VG_DURATION} linear infinite` }}
              />
              <VgDot at={geo.b1From} r={geo.rDot} fill={VG_B1} anim="vg-dot-b1" />
              <VgDot at={geo.b1TipAt} r={geo.rDot} fill={VG_B1} anim="vg-tip-b1" />

              {/* B2 · alt-bridge — branches down, merges back */}
              <path
                className="tb-vg-anim"
                d={geo.b2}
                fill="none"
                stroke={VG_B2}
                strokeWidth={geo.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset="100"
                style={{ animation: `vg-b2 ${VG_DURATION} linear infinite` }}
              />
              <VgDot at={geo.b2From} r={geo.rDot} fill={VG_B2} anim="vg-dot-b2" />
              <VgDot at={geo.b2MergeAt} r={geo.rMerge} fill={VG_B2} anim="vg-merge-b2" />

              {/* B3 · polishing — branches up, merges back */}
              <path
                className="tb-vg-anim"
                d={geo.b3}
                fill="none"
                stroke={VG_B3}
                strokeWidth={geo.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset="100"
                style={{ animation: `vg-b3 ${VG_DURATION} linear infinite` }}
              />
              <VgDot at={geo.b3From} r={geo.rDot} fill={VG_B3} anim="vg-dot-b3" />
              <VgDot at={geo.b3MergeAt} r={geo.rMerge} fill={VG_B3} anim="vg-merge-b3" />
            </svg>
          )}

          {/* MASTER label — always visible, anchored top-left (design: 60px, 310px) */}
          <div
            className="absolute inline-flex items-center whitespace-nowrap"
            style={{
              left: geo?.masterLeft ?? "5.556%",
              top: geo?.masterTop ?? "55.357%",
              gap: vgu(8),
              border: `${vgu(1)} solid var(--lime)`,
              padding: `${vgu(6)} ${vgu(12)}`,
              background: "var(--color-background)",
            }}
          >
            <span
              style={{ width: vgu(8), height: vgu(8), background: "var(--lime)", display: "inline-block" }}
            />
            <span
              className="font-mono-tb uppercase text-lime"
              style={{ fontSize: vgu(11), fontWeight: 700, letterSpacing: "0.16em" }}
            >
              MASTER
            </span>
          </div>

          <VersionGraphLabel
            index={1} color={VG_B1} tag="FIX" name="darker-mix" status="— dropped"
            left={geo?.label1Left ?? "38.9%"} top={geo?.labelTopUpper ?? "26%"} anim="vg-lbl-1"
          />
          <VersionGraphLabel
            index={2} color={VG_B2} tag="EXP" name="alt-bridge" status="→ merged"
            left={geo?.label2Left ?? "50.9%"} top={geo?.labelTopLower ?? "74%"} anim="vg-lbl-2"
          />
          <VersionGraphLabel
            index={3} color={VG_B3} tag="ARR" name="polishing" status="→ merged"
            left={geo?.label3Left ?? "75%"} top={geo?.labelTopUpper ?? "26%"} anim="vg-lbl-3"
          />
        </div>
      </div>
    </div>
  );
}
