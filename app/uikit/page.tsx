'use client'

import React, {
  useState, useContext, createContext, useRef, useEffect, useMemo, useCallback,
  type ReactNode,
} from 'react'

import { DESIGN_THEMES } from '@/lib/design-theme'
import { AppHeader, StatusFooter, SectionLabel } from '@/components/design/AppShell'
import { Button } from '@/components/ui/button'
import {
  WaveformBarRow,
  WaveformBarsPlayhead,
  makeSeededWaveformBars,
  playedPctStyle,
} from '@/components/WaveformBars'
import {
  UikitRoot,
  PageTag,
  Section,
  Tile,
  Caption,
  ActiveTheme,
  ThemeMatrix,
} from './kit-helpers'
import {
  ProductionButtonsSection,
  ProductionFormsSection,
  ProductionTagsSection,
  ProductionOverlaysSection,
  ProductionLoadingSection,
  ProductionVersioningSection,
  ProductionContextSection,
  ProductionRoadmapSection,
  ProductionAuthSection,
  ProductionThemeSection,
  ProductionShellSection,
  ProductionFilterTabsSection,
  ProductionPopoverSection,
  ProductionChecklistSection,
  ProductionErrorSection,
} from './production-sections'

// ─── Waveform demos (production components) ───────────────────────────────────

function WaveformStudioDemo() {
  const [played, setPlayed] = useState(0.46)
  const masterBars = useMemo(() => makeSeededWaveformBars(7, 96), [])
  const channelRows = useMemo(() => ([
    { label: 'Guitars', color: '#F5C544', seed: 42, progress: played },
    { label: 'Drums', color: '#5BA8FF', seed: 11, progress: 1 },
    { label: 'Bass', color: '#7DE07A', seed: 29, progress: 0.72 },
  ] as const), [played])

  const seekMaster = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPlayed(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }, [])

  return (
    <div className="space-y-4">
      <Tile>
        <SectionLabel>Master mix · scrubbable playhead</SectionLabel>
        <div
          className="relative mt-2 h-28 border border-border bg-surface/40 p-2 cursor-pointer touch-none select-none"
          style={playedPctStyle(played * 100)}
          onClick={seekMaster}
          role="slider"
          aria-valuenow={Math.round(played * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Waveform playhead position"
        >
          <div className="relative h-full">
            <WaveformBarsPlayhead bars={masterBars} color="var(--lime)" ready animKey={0} />
            <div
              className="absolute top-0 bottom-0 w-px -ml-px bg-foreground pointer-events-none z-10"
              style={{ left: 'var(--played-pct, 0%)' }}
            />
          </div>
        </div>
        <Caption className="mt-2">
          @/components/WaveformBars — rounded bars · color-mix unplayed layer · clip-path bright overlay · animate-draw-wave-h
        </Caption>
      </Tile>

      <Tile className="space-y-4">
        <SectionLabel>Per-channel rows</SectionLabel>
        {channelRows.map(row => {
          const bars = makeSeededWaveformBars(row.seed, 72)
          return (
            <div key={row.label} className="flex items-center gap-3">
              <span className="tb-type-name text-xs uppercase w-16 shrink-0" style={{ color: row.color }}>{row.label}</span>
              <div className="relative flex-1 h-14 border border-border bg-surface/30 p-1.5">
                <WaveformBarRow
                  bars={bars}
                  color={row.color}
                  progress={row.progress}
                  className="h-full"
                  animate
                />
              </div>
            </div>
          )
        })}
        <Caption>WaveformBarRow — static progress fraction per row (mixer track lanes)</Caption>
      </Tile>

      <Tile className="p-0 overflow-hidden">
        <div className="px-4 pt-4">
          <SectionLabel>Comment range overlay</SectionLabel>
        </div>
        <div className="relative h-24 mt-3 mx-4 mb-4 border border-border bg-surface/40 p-1.5">
          <WaveformBarRow
            bars={makeSeededWaveformBars(55, 80)}
            color="var(--lime)"
            progress={1}
            className="h-full opacity-80"
          />
          <div
            className="absolute inset-y-1.5 left-[28%] right-[52%] pointer-events-none waveform-accent-fill"
            aria-hidden
          />
          <div className="absolute inset-y-1.5 left-[28%] w-px waveform-accent-edge" aria-hidden />
          <div className="absolute inset-y-1.5 right-[52%] w-px waveform-accent-edge" aria-hidden />
        </div>
        <Caption className="px-4 pb-4">waveform-accent-fill / waveform-accent-edge — comment & selection ranges on mixer lanes</Caption>
      </Tile>
    </div>
  )
}

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const svgProps = { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IcoPlay({ className = 'size-5' }) { return <svg className={className} {...svgProps}><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" /></svg> }
function IcoAudioLines({ className = 'size-5' }) { return <svg className={className} {...svgProps}><path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" /></svg> }
function IcoMusic2({ className = 'size-5' }) { return <svg className={className} {...svgProps}><circle cx="8" cy="18" r="4" /><path d="M12 18V2l7 2" /></svg> }
function IcoMic({ className = 'size-5' }) { return <svg className={className} {...svgProps}><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 19v4M8 23h8" /></svg> }
function IcoHeadphones({ className = 'size-5' }) { return <svg className={className} {...svgProps}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg> }
function IcoRadio({ className = 'size-5' }) { return <svg className={className} {...svgProps}><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19" /></svg> }
function IcoSliders({ className = 'size-5' }) { return <svg className={className} {...svgProps}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg> }
function IcoVolume2({ className = 'size-5' }) { return <svg className={className} {...svgProps}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg> }
function IcoGitBranch({ className = 'size-5' }) { return <svg className={className} {...svgProps}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg> }
function IcoWaves({ className = 'size-5' }) { return <svg className={className} {...svgProps}><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /></svg> }
function IcoAlarmClock({ className = 'size-5' }) { return <svg className={className} {...svgProps}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3" /><path d="M6.38 18.7 4 21M17.64 18.67 20 21" /></svg> }
function IcoCheck({ className = 'size-5' }) { return <svg className={className} {...svgProps}><polyline points="20 6 9 17 4 12" /></svg> }
function IcoChevronDown({ className = 'size-4' }) { return <svg className={className} {...svgProps}><polyline points="6 9 12 15 18 9" /></svg> }

// ─── UI Components ───────────────────────────────────────────────────────────

// Input
function Input({ placeholder, className = '', id, defaultValue }: { placeholder?: string; className?: string; id?: string; defaultValue?: string }) {
  return (
    <input
      id={id}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={`flex h-9 w-full border border-border bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    />
  )
}

// Label
function Label({ children, htmlFor, className = '' }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return <label htmlFor={htmlFor} className={`text-sm font-medium leading-none ${className}`}>{children}</label>
}

// Textarea
function Textarea({ placeholder, rows = 4, className = '' }: { placeholder?: string; rows?: number; className?: string }) {
  return (
    <textarea
      placeholder={placeholder}
      rows={rows}
      className={`flex w-full border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none ${className}`}
    />
  )
}

// Checkbox
function Checkbox({ id, defaultChecked }: { id?: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked ?? false)
  return (
    <button
      id={id}
      role="checkbox"
      aria-checked={checked}
      onClick={() => setChecked(c => !c)}
      className={`h-4 w-4 shrink-0 border border-border transition-colors ${checked ? 'bg-primary border-primary' : 'bg-transparent'}`}
    >
      {checked && <IcoCheck className="size-3 text-primary-foreground" />}
    </button>
  )
}

// RadioGroup
type RadioCtx = { value: string; onChange: (v: string) => void }
const RadioContext = createContext<RadioCtx>({ value: '', onChange: () => {} })
function RadioGroup({ defaultValue, children, className = '' }: { defaultValue?: string; children: ReactNode; className?: string }) {
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <RadioContext.Provider value={{ value, onChange: setValue }}>
      <div role="radiogroup" className={className}>{children}</div>
    </RadioContext.Provider>
  )
}
function RadioGroupItem({ value, id }: { value: string; id?: string }) {
  const ctx = useContext(RadioContext)
  const active = ctx.value === value
  return (
    <button
      id={id}
      role="radio"
      aria-checked={active}
      onClick={() => ctx.onChange(value)}
      className={`h-4 w-4 shrink-0 rounded-full border transition-colors flex items-center justify-center ${active ? 'border-primary' : 'border-border'}`}
    >
      {active && <span className="h-2 w-2 rounded-full bg-primary" />}
    </button>
  )
}

// Switch
function Switch({ id, defaultChecked }: { id?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(defaultChecked ?? false)
  return (
    <button
      id={id}
      role="switch"
      aria-checked={on}
      onClick={() => setOn(v => !v)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}
    >
      <span className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

// Slider
function Slider({ defaultValue, className = '' }: { defaultValue?: number[]; className?: string }) {
  const [val, setVal] = useState(defaultValue?.[0] ?? 50)
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={val}
      onChange={e => setVal(Number(e.target.value))}
      className={`w-full accent-lime h-1 ${className}`}
      style={{ accentColor: 'var(--lime)' }}
    />
  )
}

// Alert
type AlertVariant = 'default' | 'destructive'
function Alert({ children, variant = 'default', className = '' }: { children: ReactNode; variant?: AlertVariant; className?: string }) {
  return (
    <div className={`relative w-full border px-4 py-3 text-sm ${variant === 'destructive' ? 'border-destructive/50 text-destructive' : 'border-border text-foreground'} ${className}`}>
      {children}
    </div>
  )
}
function AlertTitle({ children }: { children: ReactNode }) {
  return <div className="font-medium mb-1 tracking-tight">{children}</div>
}
function AlertDescription({ children }: { children: ReactNode }) {
  return <div className="text-sm opacity-90">{children}</div>
}

// Card
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-border bg-card text-card-foreground shadow-sm ${className}`}>{children}</div>
}
function CardHeader({ children }: { children: ReactNode }) {
  return <div className="flex flex-col space-y-1.5 p-6">{children}</div>
}
function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="font-display text-2xl font-semibold leading-none tracking-tight">{children}</h3>
}
function CardDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
function CardContent({ children }: { children: ReactNode }) {
  return <div className="p-6 pt-0">{children}</div>
}

// Tabs
type TabsCtx = { value: string; onChange: (v: string) => void }
const TabsContext = createContext<TabsCtx>({ value: '', onChange: () => {} })
function Tabs({ value, defaultValue, onValueChange, children, className = '' }: {
  value?: string; defaultValue?: string; onValueChange?: (v: string) => void; children: ReactNode; className?: string
}) {
  const [local, setLocal] = useState(defaultValue ?? value ?? '')
  const current = value !== undefined ? value : local
  const onChange = (v: string) => { setLocal(v); onValueChange?.(v) }
  return (
    <TabsContext.Provider value={{ value: current, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}
function TabsList({ children, className = '' }: { children: ReactNode; className?: string }) {
  const defaultCls = 'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground'
  return <div role="tablist" className={className || defaultCls}>{children}</div>
}
function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext)
  const active = ctx.value === value
  const pillCls = 'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow'
  return (
    <button
      role="tab"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      onClick={() => ctx.onChange(value)}
      className={className === undefined ? pillCls : className}
    >
      {children}
    </button>
  )
}
function TabsContent({ value, children, className = '' }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext)
  if (ctx.value !== value) return null
  return <div role="tabpanel" className={`mt-2 ${className}`}>{children}</div>
}

// Accordion
type AccordionCtx = { open: string | null; toggle: (v: string) => void; collapsible: boolean }
const AccordionContext = createContext<AccordionCtx>({ open: null, toggle: () => {}, collapsible: true })
type AccordionItemCtx = { value: string }
const AccordionItemContext = createContext<AccordionItemCtx>({ value: '' })
function Accordion({ type = 'single', collapsible = false, defaultValue, children }: { type?: string; collapsible?: boolean; defaultValue?: string; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(defaultValue ?? null)
  const toggle = (v: string) => setOpen(o => (collapsible && o === v) ? null : v)
  return (
    <AccordionContext.Provider value={{ open, toggle, collapsible }}>
      <div>{children}</div>
    </AccordionContext.Provider>
  )
}
function AccordionItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <AccordionItemContext.Provider value={{ value }}>
      <div className="border-b border-border">{children}</div>
    </AccordionItemContext.Provider>
  )
}
function AccordionTrigger({ children }: { children: ReactNode }) {
  const { value } = useContext(AccordionItemContext)
  const { open, toggle } = useContext(AccordionContext)
  const isOpen = open === value
  return (
    <button
      type="button"
      onClick={() => toggle(value)}
      className="flex w-full items-center justify-between py-4 text-sm font-medium text-left transition-all hover:underline"
      data-state={isOpen ? 'open' : 'closed'}
    >
      {children}
      <IcoChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
    </button>
  )
}
function AccordionContent({ children }: { children: ReactNode }) {
  const { value } = useContext(AccordionItemContext)
  const { open } = useContext(AccordionContext)
  const isOpen = open === value
  return (
    <div className="tb-accordion-panel" data-state={isOpen ? 'open' : 'closed'}>
      <div className="tb-accordion-panel-inner">
        <div className="pb-4 pt-0 text-sm">{children}</div>
      </div>
    </div>
  )
}

// Select
type SelectCtx = { value: string; setValue: (v: string) => void; open: boolean; setOpen: (v: boolean) => void; label: string; setLabel: (v: string) => void }
const SelectContext = createContext<SelectCtx>({ value: '', setValue: () => {}, open: false, setOpen: () => {}, label: '', setLabel: () => {} })
function Select({ children }: { children: ReactNode }) {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <SelectContext.Provider value={{ value, setValue, open, setOpen, label, setLabel }}>
      <div ref={ref} className="relative">{children}</div>
    </SelectContext.Provider>
  )
}
function SelectTrigger({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useContext(SelectContext)
  return (
    <button
      onClick={() => setOpen(!open)}
      className={`flex h-9 w-full items-center justify-between border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none ${className}`}
    >
      {children}
      <IcoChevronDown className={`size-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}
function SelectValue({ placeholder }: { placeholder?: string }) {
  const { label } = useContext(SelectContext)
  return <span className={label ? '' : 'text-muted-foreground'}>{label || placeholder}</span>
}
function SelectContent({ children }: { children: ReactNode }) {
  const { open } = useContext(SelectContext)
  if (!open) return null
  return (
    <div className="absolute z-50 w-full border border-border bg-popover text-popover-foreground shadow-lg top-full mt-1">
      <div className="p-1">{children}</div>
    </div>
  )
}
function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(SelectContext)
  return (
    <button
      className={`relative flex w-full cursor-pointer select-none items-center px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${ctx.value === value ? 'bg-accent text-accent-foreground' : ''}`}
      onClick={() => { ctx.setValue(value); ctx.setLabel(String(children)); ctx.setOpen(false) }}
    >
      {children}
    </button>
  )
}

// Table
function Table({ children }: { children: ReactNode }) { return <table className="w-full caption-bottom text-sm">{children}</table> }
function TableHeader({ children }: { children: ReactNode }) { return <thead>{children}</thead> }
function TableBody({ children }: { children: ReactNode }) { return <tbody className="[&_tr:last-child]:border-0">{children}</tbody> }
function TableRow({ children }: { children: ReactNode }) { return <tr className="border-b border-border transition-colors hover:bg-muted/50">{children}</tr> }
function TableHead({ children, className = '' }: { children?: ReactNode; className?: string }) { return <th className={`h-10 px-4 text-left align-middle font-medium text-muted-foreground ${className}`}>{children}</th> }
function TableCell({ children, className = '' }: { children?: ReactNode; className?: string }) { return <td className={`px-4 py-2 align-middle ${className}`}>{children}</td> }

// Skeleton
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-primary/10 ${className}`} />
}

const TOKENS = [
  { name: 'background', role: 'Canvas / page surface' },
  { name: 'foreground', role: 'Primary text on canvas' },
  { name: 'surface', role: 'Panels, cards' },
  { name: 'surface-2', role: 'Inset / pressed surface' },
  { name: 'border', role: 'Hairlines, dividers' },
  { name: 'muted', role: 'Quiet backgrounds' },
  { name: 'muted-foreground', role: 'Secondary text' },
  { name: 'primary', role: 'Primary action' },
  { name: 'primary-foreground', role: 'On primary' },
  { name: 'lime', role: 'Signature accent' },
  { name: 'lime-soft', role: 'Accent wash' },
  { name: 'destructive', role: 'Errors, danger' },
  { name: 'chart-1', role: 'Vocals / lead' },
  { name: 'chart-2', role: 'Drums' },
  { name: 'chart-3', role: 'Bass' },
  { name: 'chart-4', role: 'Keys' },
  { name: 'chart-5', role: 'Synth / pad' },
  { name: 'online', role: 'Live / online status' },
]

const TYPE_SCALE: { label: string; cls: string; sample: string; spec: string }[] = [
  { label: 'Display XL',  cls: 'tb-type-display-xl',  sample: 'Wildfire',                                      spec: 'Archivo · 72 / 0.92 · ‑0.04em · 700' },
  { label: 'Display L',   cls: 'tb-type-display-l',   sample: 'Branch the chorus',                               spec: 'Archivo · 48 / 1 · ‑0.03em · 700' },
  { label: 'Display M',   cls: 'tb-type-display-m',   sample: 'Master player',                                  spec: 'Archivo · 30 · 700' },
  { label: 'Entity name', cls: 'tb-type-name text-2xl uppercase', sample: 'Test! Test!',                    spec: 'Archivo · 700 · ‑0.02em · band / track / member names' },
  { label: 'Body L',      cls: 'tb-type-body-l',      sample: 'Synchronized multitrack playback, chord-aware timelines.', spec: 'JetBrains Mono · 16 / 1.6' },
  { label: 'Body M',      cls: 'tb-type-body-m',      sample: 'Drop a comment on bar 36–40 of the lead vocal.',  spec: 'JetBrains Mono · 14 / 1.6' },
  { label: 'Meta',        cls: 'tb-type-meta',        sample: 'BAR 36 · 1:14 · ALEX',                           spec: 'JetBrains Mono · 10 / 0.18em' },
  { label: 'Mono Numeric',cls: 'tb-type-mono-numeric', sample: '124 BPM · 04:18 / 06:22',                        spec: 'JetBrains Mono · tabular' },
]

// ─── Main page ───────────────────────────────────────────────────────────────

function UikitContent() {
  const [tab, setTab] = useState('foundations')

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader
        crumbs={<span className="text-foreground">UI Kit</span>}
        right={
          <a href="/dashboard"
            className="hidden sm:inline-flex border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest hover:border-lime hover:text-lime no-underline text-muted-foreground"
          >
            ← App
          </a>
        }
      />

      {/* Hero */}
      <section className="border-b border-border bg-surface/30">
        <div className="px-6 py-10 max-w-6xl mx-auto grid gap-6 lg:grid-cols-[2fr_1fr] items-end">
          <div>
            <PageTag>● BRANDBOOK v0.9</PageTag>
            <h1 className="tb-hero-title">
              <span className="tb-hero-title-brand">Trackbase</span>
              {' / '}
              <span className="tb-hero-title-accent">UI Kit</span>
            </h1>
            <p className="tb-hero-lead">
              Production components imported from <code className="font-mono text-xs">@/components/design</code> and{' '}
              <code className="font-mono text-xs">@/components/ui</code> — the same code the app runs.
              Themes sync via <code className="font-mono text-xs">useDesignTheme()</code>.
            </p>
          </div>
          <div className="border border-border bg-background p-4">
            <SectionLabel>Active theme</SectionLabel>
            <div className="mt-3 flex items-center justify-between gap-3">
              <ActiveTheme />
              <a href="#theme-picker" className="text-[10px] uppercase tracking-widest text-lime hover:underline no-underline">
                Change theme →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Section nav */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col">
        <div className="sticky top-14 z-30 border-b border-border bg-background/95 backdrop-blur px-6">
          <div className="max-w-6xl mx-auto overflow-x-auto">
            <TabsList className="tb-tabs-underline inline-flex h-12">
              {([
                ['foundations', '01 · Foundations'],
                ['color',       '02 · Color & Themes'],
                ['type',        '03 · Typography'],
                ['components',  '04 · Components'],
                ['studio',      '05 · Studio Elements'],
                ['product',     '06 · Product Surfaces'],
                ['motion',      '07 · Motion'],
                ['voice',       '08 · Voice'],
              ] as [string, string][]).map(([id, label]) => (
                <TabsTrigger key={id} value={id} className="">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        <div className="px-6 py-10 max-w-6xl mx-auto w-full space-y-16">

          {/* ─── FOUNDATIONS ─── */}
          <TabsContent value="foundations" className="m-0 space-y-12">
            <Section title="Logotype" id="logotype" tag="01.01">
              <div className="grid sm:grid-cols-2 gap-4">
                <Tile>
                  <div className="font-display text-3xl font-bold tracking-tight text-lime">TRACKBASE</div>
                  <Caption>Primary wordmark · Archivo Bold · lime</Caption>
                </Tile>
                <Tile>
                  <div className="font-display text-3xl font-bold tracking-tight text-foreground">TRACKBASE<span className="text-lime">.</span></div>
                  <Caption>Inline lockup · use in dense headers</Caption>
                </Tile>
              </div>
            </Section>

            <Section title="Grid & spacing" id="grid" tag="01.02">
              <div className="grid md:grid-cols-2 gap-6">
                <Tile className="h-48 grid-bg relative">
                  <Caption className="absolute bottom-3 left-3">40px master grid</Caption>
                </Tile>
                <Tile className="h-48 grid-bg-sm relative">
                  <Caption className="absolute bottom-3 left-3">16px micro grid (bar lines)</Caption>
                </Tile>
              </div>
              <div className="grid sm:grid-cols-6 gap-2 mt-4">
                {[2, 4, 8, 12, 16, 24].map(sp => (
                  <div key={sp} className="border border-border p-3 text-center text-[10px] uppercase tracking-widest">
                    <div className="mx-auto bg-lime" style={{ width: sp, height: sp }} />
                    <div className="mt-2 text-muted-foreground">{sp}px</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Iconography" id="icons" tag="01.03">
              <Caption className="mb-3">Lucide, 1.75px stroke. Reserved set for studio actions.</Caption>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {([
                  [IcoPlay, 'Play'], [IcoAudioLines, 'Wave'], [IcoMusic2, 'Note'], [IcoMic, 'Vocal'],
                  [IcoHeadphones, 'Mix'], [IcoRadio, 'Live'], [IcoSliders, 'Fader'], [IcoVolume2, 'Vol'],
                  [IcoGitBranch, 'Branch'], [IcoWaves, 'Stem'], [IcoAlarmClock, 'Cue'], [IcoCheck, 'OK'],
                ] as [React.FC<{className?: string}>, string][]).map(([Icon, label], i) => (
                  <div key={i} className="border border-border p-4 grid place-items-center gap-2 hover:border-lime hover:text-lime transition-colors">
                    <Icon className="size-5" />
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Radius & elevation" id="radius" tag="01.04">
              <div className="grid sm:grid-cols-4 gap-3">
                {([['none','0'],['sm','2px'],['md','6px'],['lg','10px']] as [string,string][]).map(([k, v]) => (
                  <Tile key={k}>
                    <div className={`h-16 bg-lime/80`} style={{ borderRadius: v === '0' ? 0 : v }} />
                    <Caption className="mt-2">radius-{k} · {v}</Caption>
                  </Tile>
                ))}
              </div>
            </Section>
          </TabsContent>

          {/* ─── COLOR ─── */}
          <TabsContent value="color" className="m-0 space-y-12">
            <Section title="Theme matrix" id="themes" tag="02.01">
              <Caption className="mb-4">Four themes ship with the product. The default is brutalist; the rest soften the contrast for long sessions or daylight rooms.</Caption>
              <ThemeMatrix />
            </Section>

            <Section title="Semantic tokens" id="tokens" tag="02.02">
              <Caption className="mb-3">Every color in the product is a semantic token. Never hardcode hex in components.</Caption>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {TOKENS.map(t => (
                  <div key={t.name} className="border border-border flex items-stretch">
                    <div className="w-14 shrink-0" style={{ background: `var(--${t.name})` }} />
                    <div className="px-3 py-2 min-w-0 flex-1">
                      <div className="font-mono text-[11px] truncate">--{t.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{t.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Channel palette" id="channels" tag="02.03">
              <Caption className="mb-3">Per-instrument colors used on waveforms, MIDI clips and channel chips.</Caption>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {([
                  ['#FF4D00','Vocal'], ['#5BA8FF','Drums'], ['#7DE07A','Bass'],
                  ['#F5C544','Guitar'], ['#C58CFF','Keys'], ['#FF7AB6','Synth'], ['#46E0D2','Perc'],
                ] as [string, string][]).map(([hex, name]) => (
                  <div key={hex} className="border border-border">
                    <div className="h-14" style={{ background: hex }} />
                    <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest flex justify-between">
                      <span>{name}</span>
                      <span className="text-muted-foreground font-mono">{hex}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <ProductionThemeSection />
          </TabsContent>

          {/* ─── TYPE ─── */}
          <TabsContent value="type" className="m-0 space-y-12">
            <Section title="Type families" id="families" tag="03.01">
              <div className="grid md:grid-cols-2 gap-4">
                <Tile>
                  <div className="tb-type-family-display">Archivo</div>
                  <Caption className="mt-2">Display · Headings, entity names, accent CTAs</Caption>
                </Tile>
                <Tile>
                  <div className="tb-type-family-mono">JetBrains Mono</div>
                  <Caption className="mt-2">Body & meta · Timecodes, tokens, BPM, file names</Caption>
                </Tile>
              </div>
            </Section>

            <Section title="Scale" id="scale" tag="03.02">
              <div className="border border-border divide-y">
                {TYPE_SCALE.map(row => (
                  <div key={row.label} className="grid grid-cols-[160px_1fr] items-baseline gap-6 px-4 py-5">
                    <div className="tb-type-spec-label">
                      <strong>{row.label}</strong>
                      <div className="tb-type-spec-meta">{row.spec}</div>
                    </div>
                    <div className={row.cls}>{row.sample}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Entity names" id="entity-names" tag="03.03">
              <Caption className="mb-3">
                <code className="font-mono text-[10px]">.tb-type-name</code> — production surfaces: dashboard greeting, band &amp; project titles, member display names (not @handles).
              </Caption>
              <div className="border border-border divide-y">
                <div className="px-4 py-5">
                  <Caption className="mb-2">Dashboard greeting</Caption>
                  <h1 className="tb-type-name text-4xl sm:text-5xl uppercase tracking-tighter m-0 leading-none">
                    Good afternoon, <span className="text-lime">Rubicon</span>.
                  </h1>
                </div>
                <div className="px-4 py-5">
                  <Caption className="mb-2">Band page hero</Caption>
                  <h1 className="tb-type-name text-4xl sm:text-5xl uppercase tracking-tighter m-0">Test! Test!</h1>
                </div>
                <div className="px-4 py-5">
                  <Caption className="mb-2">Project list row</Caption>
                  <div className="tb-type-name text-xl uppercase tracking-tight">Cat (formerly Dog)</div>
                </div>
                <div className="px-4 py-5 flex items-center gap-3">
                  <div className="size-8 bg-surface-2 grid place-items-center text-[10px] font-bold shrink-0">RU</div>
                  <div className="min-w-0">
                    <div className="tb-type-name text-sm uppercase truncate">rubicon</div>
                    <div className="text-[9px] text-muted-foreground truncate">@rubicon</div>
                  </div>
                </div>
              </div>
            </Section>
          </TabsContent>

          {/* ─── COMPONENTS ─── */}
          <TabsContent value="components" className="m-0 space-y-12">
            <ProductionButtonsSection />
            <ProductionFormsSection />
            <ProductionTagsSection />

            <Section title="Cards & alerts" id="cards" tag="04.04">
              <div className="grid md:grid-cols-2 gap-6">
                <Card className="rounded-none">
                  <CardHeader>
                    <CardTitle>Wildfire</CardTitle>
                    <CardDescription>14 tracks · 124 BPM · Eb Minor</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <WaveformBarRow
                      bars={makeSeededWaveformBars(3, 48)}
                      color="var(--lime)"
                      progress={0.65}
                      className="h-12"
                    />
                  </CardContent>
                </Card>
                <div className="space-y-3">
                  <Alert>
                    <AlertTitle>Ready to apply</AlertTitle>
                    <AlertDescription>3 versions can be applied without overlapping changes.</AlertDescription>
                  </Alert>
                  <Alert variant="destructive">
                    <AlertTitle>Overlapping changes</AlertTitle>
                    <AlertDescription>Lead Vocal differs between Master and feature/dirty-synth.</AlertDescription>
                  </Alert>
                </div>
              </div>
            </Section>

            <Section title="Tabs · Accordion" id="layered" tag="04.05">
              <div className="grid md:grid-cols-2 gap-6">
                <Tile>
                  <Caption className="mb-3">Underline tabs — dashboard / band page pattern</Caption>
                  <Tabs defaultValue="mix">
                    <TabsList className="tb-tabs-underline">
                      <TabsTrigger value="mix" className="">Mix</TabsTrigger>
                      <TabsTrigger value="lyrics" className="">Lyrics</TabsTrigger>
                      <TabsTrigger value="notes" className="">Notes</TabsTrigger>
                    </TabsList>
                    <TabsContent value="mix" className="text-sm text-muted-foreground pt-3">7 tracks · 18 comments</TabsContent>
                    <TabsContent value="lyrics" className="text-sm text-muted-foreground pt-3">Verse 1, Chorus, Bridge</TabsContent>
                    <TabsContent value="notes" className="text-sm text-muted-foreground pt-3">Recorded April 2 — re-tracked bridge.</TabsContent>
                  </Tabs>
                </Tile>
                <Tile>
                  <Accordion type="single" collapsible defaultValue="a1">
                    <AccordionItem value="a1">
                      <AccordionTrigger>Versioning</AccordionTrigger>
                      <AccordionContent>Every save is a snapshot. Branch the mix without losing what works.</AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="a2">
                      <AccordionTrigger>Comments</AccordionTrigger>
                      <AccordionContent>Pin threaded notes to bar ranges of any track.</AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Tile>
              </div>
            </Section>

            <ProductionOverlaysSection />

            <Section title="Form controls (legacy reference)" id="form-controls" tag="04.11">
              <div className="grid md:grid-cols-2 gap-6">
                <Tile className="space-y-3">
                  <Caption className="mb-1">Native-style controls — prefer TbInput + chip selectors in product UI</Caption>
                  <div>
                    <Label>Project name</Label>
                    <Input placeholder="Wildfire" className="mt-1 focus-visible:ring-0 focus-visible:border-lime" />
                  </div>
                  <div>
                    <Label>Time signature</Label>
                    <Select>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="4/4" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="44">4/4</SelectItem>
                        <SelectItem value="34">3/4</SelectItem>
                        <SelectItem value="68">6/8</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Tile>
                <Tile className="space-y-5">
                  <div className="flex items-center gap-3">
                    <Checkbox id="cb" defaultChecked />
                    <Label htmlFor="cb">Auto-apply non-overlapping versions</Label>
                  </div>
                  <RadioGroup defaultValue="audio" className="space-y-1">
                    <div className="flex items-center gap-2"><RadioGroupItem value="audio" id="r1" /><Label htmlFor="r1">Audio (WAV)</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="midi" id="r2" /><Label htmlFor="r2">MIDI</Label></div>
                  </RadioGroup>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sw">Click track</Label>
                    <Switch id="sw" defaultChecked />
                  </div>
                  <div>
                    <Label>Master volume</Label>
                    <Slider defaultValue={[75]} className="mt-2" />
                  </div>
                </Tile>
              </div>
            </Section>

            <Section title="Table" id="table" tag="04.12">
              <div className="border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead>Author</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Comments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {([
                      ['main', 'Alex', 'current', 12],
                      ['feature/dirty-synth', 'Alex', 'branch', 4],
                      ['alt/percussion-b', 'Sarah', 'branch', 2],
                      ['exp/bridge-rework', 'Tom', 'merged', 8],
                    ] as [string, string, string, number][]).map(([b, a, s, c]) => (
                      <TableRow key={b}>
                        <TableCell className="font-mono text-xs">{b}</TableCell>
                        <TableCell>{a}</TableCell>
                        <TableCell><span className="text-[10px] uppercase tracking-widest text-lime">{s}</span></TableCell>
                        <TableCell className="text-right tabular-nums">{c}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>

            <Section title="Loading & empty" id="loading-empty" tag="04.09">
              <div className="grid md:grid-cols-2 gap-6">
                <Tile className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-12 w-full" />
                  <Caption className="pt-2">Skeleton — placeholder blocks (prefer SpinnerBars in product)</Caption>
                </Tile>
                <Tile className="text-center">
                  <div className="text-3xl">∅</div>
                  <div className="tb-type-name text-2xl uppercase tracking-tight mt-2">No projects yet</div>
                  <Caption className="mt-1">Spin up your first song with one click.</Caption>
                  <Button className="mt-3">+ New Project</Button>
                </Tile>
              </div>
            </Section>

            <ProductionLoadingSection />
            <ProductionPopoverSection />
          </TabsContent>

          {/* ─── STUDIO ─── */}
          <TabsContent value="studio" className="m-0 space-y-12">
            <Section title="Waveform" id="waveform" tag="05.01">
              <WaveformStudioDemo />
            </Section>

            <Section title="Bar grid · chord ribbon" id="grid-strip" tag="05.02">
              <Tile className="p-0 overflow-hidden">
                <div className="flex bg-lime-soft/40 border-b border-border">
                  {([['INTRO','Ebm—Bbm'],['VERSE 1','Ebm7—Ab9'],['CHORUS','Bbm7—Ebm'],['BRIDGE','Gbmaj7—Db']] as [string,string][]).map(([n, c]) => (
                    <div key={n} className="flex-1 px-3 py-2 border-r border-lime/30 last:border-r-0">
                      <div className="text-[9px] font-bold tracking-widest text-lime">{n}</div>
                      <div className="text-[10px]">{c}</div>
                    </div>
                  ))}
                </div>
                <div className="flex">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div key={i} className="flex-1 border-r border-border/40 last:border-r-0 px-2 py-1 text-[9px] tabular-nums text-muted-foreground">
                      {String(i * 8 + 1).padStart(2, '0')}
                    </div>
                  ))}
                </div>
              </Tile>
            </Section>

            <Section title="Comment pin" id="comment-pin" tag="05.03">
              <Tile className="p-0">
                <div className="relative h-20 bg-surface">
                  <div className="absolute inset-y-0 left-[30%] right-[55%] waveform-accent-fill border-x border-transparent">
                    <div className="absolute inset-y-0 left-0 w-px waveform-accent-edge" />
                    <div className="absolute inset-y-0 right-0 w-px waveform-accent-edge" />
                    <div className="absolute -top-1 left-0 size-2 waveform-accent-edge" />
                  </div>
                  <div className="absolute top-3 left-[32%] w-56 border border-border bg-background p-3 shadow-2xl">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Sarah · 12m · BAR 36–40</div>
                    <div className="text-xs">Slightly flat in this passage — re-tune?</div>
                  </div>
                </div>
              </Tile>
            </Section>

            <Section title="Channel chip" id="channel-chip" tag="05.04">
              <div className="grid sm:grid-cols-2 gap-3">
                {([
                  ['Lead Vocal','#FF4D00','V'],
                  ['Drum Buss','#5BA8FF','D'],
                  ['Bass DI','#7DE07A','B'],
                  ['Rhodes','#C58CFF','R'],
                ] as [string, string, string][]).map(([n, c, l]) => (
                  <div key={n} className="flex items-center gap-3 border border-border p-3">
                    <div className="size-7 grid place-items-center text-xs font-bold text-background" style={{ background: c }}>{l}</div>
                    <div className="flex-1 min-w-0">
                      <div className="tb-type-name text-sm uppercase">{n}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">stem · 42 MB</div>
                    </div>
                    <button className="size-5 border border-border text-[9px]">M</button>
                    <button className="size-5 border border-border text-[9px]">S</button>
                  </div>
                ))}
              </div>
            </Section>

            <ProductionVersioningSection />
            <ProductionContextSection />
            <ProductionRoadmapSection />
          </TabsContent>

          {/* ─── PRODUCT ─── */}
          <TabsContent value="product" className="m-0 space-y-12">
            <ProductionShellSection />
            <ProductionAuthSection />
            <ProductionFilterTabsSection />
            <ProductionChecklistSection />
            <ProductionErrorSection />
          </TabsContent>

          {/* ─── MOTION ─── */}
          <TabsContent value="motion" className="m-0 space-y-12">
            <Section title="Motion library" id="motion-lib" tag="07.01">
              <div className="grid sm:grid-cols-3 gap-3">
                <Tile>
                  <div className="size-12 bg-lime animate-pulse-dot" />
                  <Caption className="mt-2">pulse-dot · 1.6s · live indicators</Caption>
                </Tile>
                <Tile>
                  <div className="h-12">
                    <WaveformBarRow
                      bars={makeSeededWaveformBars(99, 30)}
                      color="var(--lime)"
                      progress={1}
                      className="h-full"
                      animate
                    />
                  </div>
                  <Caption className="mt-2">draw-wave-h · 0.7s · height-only load-in (opacity stays caller-controlled)</Caption>
                </Tile>
                <Tile>
                  <div className="border border-border p-3 animate-slide-in">Slide-in · 0.6s</div>
                  <Caption className="mt-2">slide-in · panels & content reveal</Caption>
                </Tile>
              </div>
              <Caption className="mt-3">Easing: <span className="font-mono">cubic-bezier(0.32, 0.72, 0, 1)</span> — physical, snappy.</Caption>
            </Section>
          </TabsContent>

          {/* ─── VOICE ─── */}
          <TabsContent value="voice" className="m-0 space-y-12">
            <Section title="Voice & tone" id="voice" tag="08.01">
              <div className="grid md:grid-cols-2 gap-4">
                <Tile>
                  <SectionLabel>We are</SectionLabel>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li>– Direct, never decorative</li>
                    <li>– Built by musicians, for musicians</li>
                    <li>– Mechanical-confident, like good studio gear</li>
                    <li>– Specific: bars, takes, versions — not "items"</li>
                  </ul>
                </Tile>
                <Tile>
                  <SectionLabel>We are not</SectionLabel>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>– Marketing-soft ("Unleash your creativity!")</li>
                    <li>– Generic SaaS-speak ("dashboards", "items")</li>
                    <li>– Purple-gradient AI aesthetic</li>
                    <li>– Cute or condescending</li>
                  </ul>
                </Tile>
              </div>
            </Section>
            <Section title="Sample copy" id="copy" tag="08.02">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <Tile><Caption>Accent CTA</Caption><div className="mt-2"><button type="button" className="tb-btn-accent bg-lime text-primary-foreground border border-lime px-4 py-2 text-sm uppercase">Initialize studio</button></div></Tile>
                <Tile><Caption>Empty state</Caption><div className="mt-1">No takes yet. Drop a WAV to get started.</div></Tile>
                <Tile><Caption>Toast — success</Caption><div className="mt-1">Branch merged. 3 conflicts resolved.</div></Tile>
                <Tile><Caption>Toast — error</Caption><div className="mt-1 text-destructive">Couldn't reach the mixer. Hold tight — auto-retrying.</div></Tile>
              </div>
            </Section>
          </TabsContent>

        </div>
      </Tabs>

      <StatusFooter
        left={<span>UI KIT · {TOKENS.length} TOKENS · {DESIGN_THEMES.length} THEMES</span>}
        right={<span>BRANDBOOK // v0.9</span>}
      />
    </div>
  )
}

// ─── Default export ──────────────────────────────────────────────────────────
export default function UikitPage() {
  return (
    <UikitRoot>
      <UikitContent />
    </UikitRoot>
  )
}
