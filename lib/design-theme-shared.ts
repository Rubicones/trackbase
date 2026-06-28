export type DesignThemeId =
  | 'lime'
  | 'blush-dark'
  | 'blush-light'
  | 'studio-dark'
  | 'studio-dim-light'
  | 'studio-light'
  | 'studio-paper-dark'

const LEGACY_LIME_THEME_IDS = new Set(['ember-dark', 'ember-light'])

export const DESIGN_THEMES: {
  id: DesignThemeId
  label: string
  mode: 'dark' | 'light'
  swatches: string[]
  description: string
}[] = [
  {
    id: 'lime',
    label: 'Lime',
    mode: 'dark',
    swatches: ['#211f1e', '#2a2826', '#dfff00', '#f5f5f5'],
    description: 'Brutalist bone-black canvas with chartreuse accent.',
  },
  {
    id: 'blush-dark',
    label: 'Blush Dark',
    mode: 'dark',
    swatches: ['#211f1e', '#2a2826', '#f472b6', '#f5f5f5'],
    description: 'Bone-black canvas with a vivid pink accent.',
  },
  {
    id: 'blush-light',
    label: 'Blush Light',
    mode: 'light',
    swatches: ['#f5f5f5', '#ffffff', '#e85d9a', '#1a1a1a'],
    description: 'Clean light studio with a pink accent.',
  },
  {
    id: 'studio-dark',
    label: 'Studio Dim',
    mode: 'dark',
    swatches: ['#1f242c', '#2a313b', '#5ac8e6', '#e8ecf1'],
    description: 'Calmer slate-blue night mode with a cool teal accent.',
  },
  {
    id: 'studio-dim-light',
    label: 'Studio Dim Light',
    mode: 'light',
    swatches: ['#eef2f7', '#f8fafc', '#2a9cb8', '#1a2433'],
    description: 'Cool slate daylight with the same teal accent as Studio Dim.',
  },
  {
    id: 'studio-light',
    label: 'Studio Paper',
    mode: 'light',
    swatches: ['#f9f7f3', '#ffffff', '#6d58c8', '#1d2030'],
    description: 'Warm paper background with a muted indigo accent.',
  },
  {
    id: 'studio-paper-dark',
    label: 'Studio Paper Dark',
    mode: 'dark',
    swatches: ['#2a2620', '#332e26', '#8f78e8', '#f0ebe3'],
    description: 'Warm paper-toned night mode with the same indigo accent.',
  },
]

export const DESIGN_THEME_STORAGE_KEY = 'tb-theme'
export const DEFAULT_DESIGN_THEME: DesignThemeId = 'lime'
export const NEXT_THEMES_STORAGE_KEY = 'theme'

const DESIGN_THEME_ID_SET = new Set<string>(DESIGN_THEMES.map(t => t.id))

export function normalizeDesignThemeId(value: string | null | undefined): DesignThemeId | null {
  if (!value) return null
  if (LEGACY_LIME_THEME_IDS.has(value)) return 'lime'
  return isDesignThemeId(value) ? value : null
}

export function isDesignThemeId(value: string | null | undefined): value is DesignThemeId {
  return !!value && DESIGN_THEME_ID_SET.has(value)
}

/** Inline script for <head> — must stay server-importable (no "use client"). */
export function buildThemeBootstrapScript(): string {
  const themeIds = JSON.stringify(DESIGN_THEMES.map(t => t.id))
  return `(function(){try{var k='${DESIGN_THEME_STORAGE_KEY}';var d='${DEFAULT_DESIGN_THEME}';var t=localStorage.getItem(k);if(t==='ember-dark'||t==='ember-light')t='lime';var theme=${themeIds}.indexOf(t)>=0?t:d;var dark=!theme.endsWith('-light');document.documentElement.setAttribute('data-theme',theme);document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';try{localStorage.setItem('${NEXT_THEMES_STORAGE_KEY}',dark?'dark':'light')}catch(e){}}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_DESIGN_THEME}');document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}})();`
}
