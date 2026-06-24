'use client'

import { useState } from 'react'
import Link from 'next/link'
import { TbButton, TbMenuButton } from '@/components/design/TbButton'
import { TbInput } from '@/components/design/TbInput'
import { TbModal } from '@/components/design/TbModal'
import { Toast } from '@/components/design/Toast'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { ThemePicker } from '@/components/design/ThemePicker'
import { SectionLabel } from '@/components/design/AppShell'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/avatar'
import { Spinner, SpinnerBars, SpinnerBlock } from '@/components/ui/Spinner'
import { TrackLoadProgressBar } from '@/components/TrackLoadProgressBar'
import { VersionChipSelector } from '@/components/VersionChipSelector'
import { MergeTargetSelector } from '@/components/merge/MergeTargetSelector'
import { RoadmapPreview } from '@/components/RoadmapPreview'
import { SongChecklist, type ChecklistItem, type ChecklistMember } from '@/components/SongChecklist'
import { ResourceContextChips } from '@/components/ResourceContextChips'
import { ResourceDeleteConfirm } from '@/components/ResourceDeleteConfirm'
import { CommentToggleBtn, MobileMixerVersionBar } from '@/components/MobileMixerVersionBar'
import { IconBranch, IconNote } from '@/components/chat/ContextIcons'
import {
  AuthButton,
  AuthDivider,
  AuthFieldLabel,
  AuthHint,
  AuthInput,
  AuthInputStatus,
  AuthModeCard,
  AuthSteps,
} from '@/components/auth/AuthPrimitives'
import type { Version } from '@/lib/types'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { MixLoader } from '@/components/MixLoader'
import { Caption, Section, Tile } from './kit-helpers'

const DEMO_VERSIONS = [
  { id: 'v-main', name: 'main', type: 'main' as const },
  { id: 'v-bridge', name: 'bridge version', type: 'branch' as const },
  { id: 'v-alt', name: 'alt/percussion', type: 'branch' as const },
]

const DEMO_VERSIONS_FULL: Version[] = [
  {
    id: 'v-main',
    name: 'main',
    type: 'main',
    project_id: 'demo',
    parent_id: null,
    created_at: new Date().toISOString(),
    merged_at: null,
    merged_into_id: null,
    tag: null,
    tracks: [],
  },
  {
    id: 'v-bridge',
    name: 'bridge version',
    type: 'branch',
    project_id: 'demo',
    parent_id: 'v-main',
    created_at: new Date().toISOString(),
    merged_at: null,
    merged_into_id: null,
    tag: null,
    tracks: [],
  },
  {
    id: 'v-merged',
    name: 'exp/bridge-rework',
    type: 'branch',
    project_id: 'demo',
    parent_id: 'v-main',
    created_at: new Date().toISOString(),
    merged_at: new Date().toISOString(),
    merged_into_id: 'v-main',
    tag: null,
    tracks: [],
  },
]

const ROADMAP_STEPS = [
  { name: 'Writing' },
  { name: 'Demo' },
  { name: 'Recording' },
  { name: 'Mix' },
  { name: 'Master' },
]

export function ProductionButtonsSection() {
  return (
    <Section title="TbButton · menu items" id="tb-buttons" tag="04.01">
      <div className="grid sm:grid-cols-2 gap-6">
        <Tile>
          <Caption className="mb-3">@/components/design/TbButton — primary app actions</Caption>
          <div className="flex flex-wrap gap-2">
            <TbButton variant="primary">Primary</TbButton>
            <TbButton variant="ghost">Ghost</TbButton>
            <TbButton variant="solid">Solid</TbButton>
            <TbButton variant="danger">Danger</TbButton>
            <TbButton variant="link">Link</TbButton>
            <TbButton variant="primary" disabled>Disabled</TbButton>
          </div>
        </Tile>
        <Tile>
          <Caption className="mb-3">TbMenuButton — dropdown / avatar menu rows</Caption>
          <div className="border border-border divide-y divide-border max-w-xs">
            <TbMenuButton active>Active item</TbMenuButton>
            <TbMenuButton>Settings</TbMenuButton>
            <TbMenuButton danger>Sign out</TbMenuButton>
          </div>
        </Tile>
        <Tile className="sm:col-span-2">
          <Caption className="mb-3">@/components/ui/button — shadcn set (font-mono)</Caption>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionFormsSection() {
  return (
    <Section title="TbInput · AuthInput" id="tb-forms" tag="04.02">
      <div className="grid md:grid-cols-2 gap-6">
        <Tile className="space-y-3">
          <Caption className="mb-1">TbInput — dashboard, band page, resources</Caption>
          <div>
            <SectionLabel>Project name</SectionLabel>
            <TbInput placeholder="Wildfire" className="mt-1" defaultValue="" />
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea
              rows={3}
              placeholder="Take 3 — re-tracked the bridge"
              className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-ember placeholder:text-muted-foreground/60 resize-none"
            />
          </div>
        </Tile>
        <Tile className="space-y-3">
          <Caption className="mb-1">AuthInput — onboarding & auth with validation states</Caption>
          <div>
            <AuthFieldLabel htmlFor="uikit-user">Username</AuthFieldLabel>
            <div className="relative mt-1">
              <AuthInput id="uikit-user" status="valid" defaultValue="alex_drummer" />
              <AuthInputStatus status="valid" />
            </div>
            <AuthHint>3–20 characters · letters, numbers, underscores</AuthHint>
          </div>
          <div>
            <AuthFieldLabel htmlFor="uikit-band">Band name</AuthFieldLabel>
            <div className="relative mt-1">
              <AuthInput id="uikit-band" status="checking" placeholder="Checking…" />
              <AuthInputStatus status="checking" />
            </div>
          </div>
          <div>
            <AuthFieldLabel htmlFor="uikit-invite">Invite code</AuthFieldLabel>
            <div className="relative mt-1">
              <AuthInput id="uikit-invite" status="invalid" defaultValue="INVALID" />
              <AuthInputStatus status="invalid" />
            </div>
            <AuthHint error>Code not found or expired</AuthHint>
          </div>
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionTagsSection() {
  return (
    <Section title="Avatars · status · progress" id="tb-tags" tag="04.03">
      <Tile>
        <Caption className="mb-3">UserAvatar — seed-colored square avatars</Caption>
        <div className="flex items-center gap-3 flex-wrap">
          {['alex', 'sarah_vox', 'tom_keys', 'noise_collective'].map(seed => (
            <UserAvatar key={seed} seed={seed} size={36} />
          ))}
          <UserAvatar seed="the_noise" size={36} kind="band" />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="border border-ember/40 bg-ember-soft px-2 py-1 text-[10px] uppercase tracking-widest text-ember">● LIVE</span>
          <span className="border border-online/40 bg-online/10 px-2 py-1 text-[10px] uppercase tracking-widest text-online">● ONLINE</span>
          <span className="border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">DRAFT</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-ember bg-ember-soft text-[9px] font-bold uppercase tracking-widest text-ember">
            <IconBranch /> main
          </span>
        </div>
        <div className="mt-4 max-w-xs space-y-3">
          <TrackLoadProgressBar loaded={3} total={7} label="Loading tracks" />
          <TrackLoadProgressBar indeterminate label="Rendering mix" />
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-[10px] text-dim">Storage</span>
              <span className="text-[10px] text-dim">2.4 / 5 GB</span>
            </div>
            <div className="h-0.5 rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-ember" style={{ width: '48%' }} />
            </div>
          </div>
        </div>
      </Tile>
    </Section>
  )
}

export function ProductionOverlaysSection() {
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  return (
    <Section title="TbModal · HoverTooltip · Toast" id="tb-overlays" tag="04.06">
      <Tile>
        <Caption className="mb-3">Production overlays — portal-based, z-index ladder</Caption>
        <div className="flex flex-wrap gap-3">
          <TbButton variant="primary" onClick={() => setModalOpen(true)}>Open TbModal</TbButton>
          <HoverTooltip label="Saved 2m ago by Alex">
            <TbButton variant="ghost">HoverTooltip</TbButton>
          </HoverTooltip>
          <TbButton
            variant="ghost"
            onClick={() => {
              setToast('Version applied. 3 overlapping changes reviewed.')
              setTimeout(() => setToast(null), 3200)
            }}
          >
            Show Toast
          </TbButton>
        </div>
        {modalOpen && (
          <TbModal onClose={() => setModalOpen(false)}>
            <SectionLabel>New version</SectionLabel>
            <p className="text-sm text-muted-foreground mt-2 mb-4">Version from Master. You can apply back later.</p>
            <TbInput placeholder="feature/dirty-synth" autoFocus />
            <div className="flex justify-end gap-2 mt-4">
              <TbButton variant="ghost" onClick={() => setModalOpen(false)}>Cancel</TbButton>
              <TbButton variant="primary" onClick={() => setModalOpen(false)}>Create</TbButton>
            </div>
          </TbModal>
        )}
        {toast && <Toast message={toast} />}
      </Tile>
    </Section>
  )
}

export function ProductionLoadingSection() {
  return (
    <Section title="Spinners · loaders" id="tb-loading" tag="04.08">
      <div className="grid md:grid-cols-3 gap-6">
        <Tile className="grid place-items-center gap-3">
          <Spinner size={28} label="Loading" />
          <Caption>Spinner — 8-tick rotor</Caption>
        </Tile>
        <Tile className="grid place-items-center gap-3">
          <SpinnerBars />
          <Caption>SpinnerBars — chat, merge preview</Caption>
        </Tile>
        <Tile>
          <SpinnerBlock label="Reading structure" />
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionVersioningSection() {
  const [versionId, setVersionId] = useState('v-main')
  const [mergeTarget, setMergeTarget] = useState('v-main')
  const [mobileActive, setMobileActive] = useState('v-main')
  const [commentMode, setCommentMode] = useState(false)

  return (
    <Section title="Version selectors · mobile bar" id="versioning" tag="05.05">
      <div className="grid md:grid-cols-2 gap-6">
        <Tile className="space-y-4">
          <Caption>VersionChipSelector — Quick Peek, merge target pattern</Caption>
          <div className="flex justify-end">
            <VersionChipSelector
              versions={DEMO_VERSIONS}
              selectedId={versionId}
              onChange={setVersionId}
              popoverLabel="Version"
            />
          </div>
          <Caption>MergeTargetSelector — merge modal</Caption>
          <div className="flex justify-end">
            <MergeTargetSelector
              branchId="v-bridge"
              versions={DEMO_VERSIONS_FULL}
              targetId={mergeTarget}
              onTargetChange={setMergeTarget}
            />
          </div>
        </Tile>
        <Tile className="p-0 overflow-hidden">
          <Caption className="px-4 pt-4 pb-2">MobileMixerVersionBar — mobile mixer / rehearsal</Caption>
          <MobileMixerVersionBar
            versions={DEMO_VERSIONS_FULL}
            activeId={mobileActive}
            onSelect={setMobileActive}
            onNewBranch={() => {}}
            commentMode={commentMode}
            commentCount={3}
            onToggleCommentMode={() => setCommentMode(v => !v)}
          />
          <div className="px-4 py-3 flex gap-2">
            <CommentToggleBtn active={commentMode} count={3} onClick={() => setCommentMode(v => !v)} />
            <CommentToggleBtn active={false} count={0} onClick={() => {}} variant="bar" className="px-2.5 text-[10px] uppercase tracking-widest" />
          </div>
        </Tile>
      </div>
      <Tile className="mt-4">
        <Caption className="mb-3">Version history sidebar pattern — timeline with merge markers</Caption>
        <div className="max-w-[208px] border border-border bg-surface/40 p-3">
          <SectionLabel>Versions</SectionLabel>
          <button type="button" className="w-full text-left px-[10px] py-1 mt-2 mb-2 text-[8px] uppercase tracking-widest text-muted-foreground">
            Hide non-active
          </button>
          {[
            { name: 'main', active: true, merged: false },
            { name: 'bridge version', active: false, merged: false, depth: 1 },
            { name: 'exp/rework', active: false, merged: true, mergedInto: 'main', depth: 1 },
          ].map(v => (
            <button
              key={v.name}
              type="button"
              className="w-full text-left rounded-lg mb-1 px-[10px] py-2 transition-colors"
              style={{
                marginLeft: (v.depth ?? 0) * 12,
                background: v.active ? 'var(--surface-2)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 shrink-0 bg-ember" />
                <span className="flex-1 text-[13px] truncate text-muted-foreground">{v.name}</span>
              </div>
              {v.merged && (
                <p className="text-[9px] uppercase tracking-widest mt-0.5 pl-[14px] m-0 flex items-center gap-1">
                  <span className="font-bold text-ember">M</span>
                  <span className="text-muted-foreground">{v.mergedInto}</span>
                </p>
              )}
            </button>
          ))}
        </div>
      </Tile>
    </Section>
  )
}

export function ProductionContextSection() {
  const [confirming, setConfirming] = useState(false)

  return (
    <Section title="Resource context · delete confirm" id="context-chips" tag="05.06">
      <div className="grid md:grid-cols-2 gap-6">
        <Tile className="space-y-3">
          <Caption>ResourceContextChips — branch + track on resource rows</Caption>
          <ResourceContextChips versionName="bridge version" trackName="Lead Vocal" />
          <ResourceContextChips versionName="main" compact />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <IconBranch size={12} />
            <span>Context icons from @/components/chat/ContextIcons</span>
            <IconNote size={12} />
          </div>
        </Tile>
        <Tile>
          <Caption className="mb-3">ResourceDeleteConfirm — inline row delete</Caption>
          {confirming ? (
            <ResourceDeleteConfirm
              label="demo_mix_v3.wav"
              onCancel={() => setConfirming(false)}
              onConfirm={() => setConfirming(false)}
            />
          ) : (
            <TbButton variant="ghost" onClick={() => setConfirming(true)}>Trigger delete confirm</TbButton>
          )}
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionRoadmapSection() {
  return (
    <Section title="Roadmap preview" id="roadmap" tag="05.07">
      <Tile className="space-y-4">
        <Caption>RoadmapPreview — project cards & compact headers</Caption>
        <div className="flex flex-wrap items-center gap-6">
          <RoadmapPreview steps={ROADMAP_STEPS} stepIndex={1} stageSince={new Date(Date.now() - 86400000 * 3).toISOString()} showCaption />
          <RoadmapPreview steps={ROADMAP_STEPS} stepIndex={4} showCaption />
        </div>
      </Tile>
    </Section>
  )
}

export function ProductionAuthSection() {
  const [mode, setMode] = useState<'join' | 'create'>('join')

  return (
    <Section title="Auth primitives" id="auth" tag="08.01">
      <div className="grid md:grid-cols-2 gap-6">
        <Tile className="space-y-4">
          <AuthSteps current={2} total={3} />
          <AuthFieldLabel htmlFor="auth-email">Email</AuthFieldLabel>
          <AuthInput id="auth-email" type="email" placeholder="you@band.com" />
          <AuthButton variant="primary">Continue</AuthButton>
          <AuthDivider />
          <AuthButton variant="ghost">Back</AuthButton>
          <AuthButton variant="link">Forgot password?</AuthButton>
        </Tile>
        <Tile>
          <Caption className="mb-3">AuthModeCard — onboarding band step</Caption>
          <div className="flex gap-2">
            <AuthModeCard
              selected={mode === 'join'}
              onClick={() => setMode('join')}
              icon="🔗"
              title="Join a band"
              description="Enter an invite code from a bandmate."
              accent="online"
            />
            <AuthModeCard
              selected={mode === 'create'}
              onClick={() => setMode('create')}
              icon="＋"
              title="Create a band"
              description="Start fresh — invite members later."
            />
          </div>
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionThemeSection() {
  return (
    <Section title="ThemePicker" id="theme-picker" tag="02.04">
      <Caption className="mb-3">
        Production theme UI lives in the avatar menu — uses useDesignTheme(), not the legacy ThemeSwitcher dropdown.
      </Caption>
      <div className="max-w-sm border border-border bg-popover shadow-2xl">
        <div className="px-3 py-2 border-b border-border text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          Theme
        </div>
        <ThemePicker />
      </div>
    </Section>
  )
}

const CHECKLIST_MEMBERS: ChecklistMember[] = [
  { user_id: 'u1', username: 'alex', display_name: 'Alex' },
  { user_id: 'u2', username: 'sarah', display_name: 'Sarah' },
]

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'c1', text: 'Re-track bridge vocals', done: false, assignee_id: 'u2',
    created_by: 'u1', created_at: new Date().toISOString(), done_at: null, position: 0,
  },
  {
    id: 'c2', text: 'Export stems for mix engineer', done: true, assignee_id: 'u1',
    created_by: 'u1', created_at: new Date().toISOString(), done_at: new Date().toISOString(), position: 1,
  },
  {
    id: 'c3', text: 'Confirm click track BPM', done: false, assignee_id: null,
    created_by: 'u2', created_at: new Date().toISOString(), done_at: null, position: 2,
  },
]

export function ProductionChecklistSection() {
  const [items, setItems] = useState(CHECKLIST_ITEMS)

  return (
    <Section title="SongChecklist" id="checklist" tag="08.04">
      <Tile className="p-0 overflow-hidden max-w-lg">
        <SongChecklist
          items={items}
          members={CHECKLIST_MEMBERS}
          variant="compact"
          onToggle={id => setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i))}
          onAdd={text => setItems(prev => [...prev, {
            id: `c${prev.length + 1}`,
            text,
            done: false,
            assignee_id: null,
            created_by: 'u1',
            created_at: new Date().toISOString(),
            done_at: null,
            position: prev.length,
          }])}
        />
      </Tile>
    </Section>
  )
}

export function ProductionErrorSection() {
  return (
    <Section title="ResourceErrorScreen" id="error-screen" tag="08.05">
      <Caption className="mb-3">Full-page access / not-found — uses AppHeader + centered card</Caption>
      <div className="border border-border max-w-sm mx-auto bg-surface p-8 flex flex-col items-center text-center gap-4">
        <div className="size-12 border border-border grid place-items-center text-muted-foreground">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <rect x="5" y="9" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">
            You don&apos;t have access to this project
          </p>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed m-0">
            Ask a band member to invite you.
          </p>
        </div>
        <TbButton variant="primary">Go to My Bands</TbButton>
      </div>
      <p className="text-[10px] text-muted-foreground mt-3 text-center">
        Live component: <code className="font-mono">@/components/design/ResourceErrorScreen</code>
      </p>
    </Section>
  )
}

export function ProductionFilterTabsSection() {
  const [filter, setFilter] = useState('all')
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'owner', label: 'Owner' },
    { id: 'member', label: 'Member' },
    { id: 'recent', label: 'Recently active' },
  ]

  return (
    <Section title="Filter tabs · list patterns" id="filter-tabs" tag="08.03">
      <Tile className="space-y-4">
        <Caption>Dashboard band filters — border-bottom active state, not filled pills</Caption>
        <div className="flex gap-4 border-b border-border">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`pb-2 text-[10px] uppercase tracking-widest transition border-b-2 -mb-px ${
                filter === t.id
                  ? 'border-ember text-ember'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Caption>Structure preview / panel tabs — same underline pattern</Caption>
        <div className="flex gap-6 border-b border-border">
          {['Resources', 'Roadmap', 'Checklist', 'Structure', 'Notes'].map((label, i) => (
            <button
              key={label}
              type="button"
              className={`pb-2 text-[10px] uppercase tracking-[0.2em] transition border-b-2 -mb-px ${
                i === 3 ? 'border-ember text-ember' : 'border-transparent text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Tile>
    </Section>
  )
}

export function ProductionPopoverSection() {
  return (
    <Section title="FloatingPopover · MixLoader" id="popovers" tag="04.10">
      <div className="grid md:grid-cols-2 gap-6">
        <Tile className="relative h-32">
          <Caption className="mb-2">FloatingPopover — waveform comments (z-6000)</Caption>
          <FloatingPopover left={16} top={80} width={224} transform="none">
            <div className="p-3 text-xs">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Sarah · BAR 36–40</div>
              Slightly flat in this passage — re-tune?
            </div>
          </FloatingPopover>
        </Tile>
        <Tile className="p-0 overflow-hidden min-h-[128px]">
          <Caption className="px-4 pt-4 pb-2">MixLoader — route transitions & BrandSpinner wrapper</Caption>
          <MixLoader label="Loading mixer" fullscreen={false} />
        </Tile>
      </div>
    </Section>
  )
}

export function ProductionShellSection() {
  return (
    <Section title="App shell" id="shell" tag="08.02">
      <Tile>
        <Caption className="mb-2">AppHeader · StatusFooter · SectionLabel — @/components/design/AppShell</Caption>
        <p className="text-sm text-muted-foreground m-0">
          This page uses the live <code className="font-mono text-xs">AppHeader</code> and{' '}
          <code className="font-mono text-xs">StatusFooter</code> with PushBellButton and AvatarDropdown.
          SectionLabel matches production: <code className="font-mono text-xs">font-bold</code>, no mono.
        </p>
        <Link href="/dashboard" className="inline-block mt-3 text-[10px] uppercase tracking-widest text-ember hover:underline no-underline">
          View in app →
        </Link>
      </Tile>
    </Section>
  )
}
