/** Shared band-activity display helpers for dashboard + band pages. */

const DELETE_ACTIONS = new Set([
  'delete',
  'track_remove',
  'project_remove',
  'structure_remove',
  'comment_remove',
  'resource_remove',
])

export function isDeleteAction(action: string): boolean {
  return DELETE_ACTIONS.has(action)
}

type ActivityColorToken =
  | 'lime'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'destructive'
  | 'foreground'
  | 'muted-foreground'

function activityColorToken(action: string): ActivityColorToken {
  if (isDeleteAction(action)) return 'destructive'

  switch (action) {
    case 'merge':
      return 'lime'
    case 'branch':
      return 'chart-3'
    case 'comment':
      return 'chart-5'
    case 'upload':
      return 'chart-2'
    case 'structure':
      return 'chart-4'
    case 'resource':
    case 'resource_update':
      return 'chart-4'
    case 'meta':
      return 'chart-4'
    case 'export':
      return 'foreground'
    default:
      return 'muted-foreground'
  }
}

/** Left-column category label (uppercased in UI). */
export function activityCategoryLabel(action: string): string {
  if (isDeleteAction(action)) return 'delete'
  return action.replace(/_/g, ' ')
}

const ACTIVITY_TEXT_CLASS: Record<ActivityColorToken, string> = {
  lime: 'text-lime',
  'chart-2': 'text-chart-2',
  'chart-3': 'text-chart-3',
  'chart-4': 'text-chart-4',
  'chart-5': 'text-chart-5',
  destructive: 'text-destructive',
  foreground: 'text-foreground',
  'muted-foreground': 'text-muted-foreground',
}

const ACTIVITY_BG_CLASS: Record<ActivityColorToken, string> = {
  lime: 'bg-lime',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  destructive: 'bg-destructive',
  foreground: 'bg-foreground',
  'muted-foreground': 'bg-muted-foreground',
}

export function activityColorClass(action: string): string {
  return ACTIVITY_TEXT_CLASS[activityColorToken(action)]
}

export function activityDotClass(action: string): string {
  return ACTIVITY_BG_CLASS[activityColorToken(action)]
}

export function activityVerb(action: string): string {
  if (isDeleteAction(action)) return 'deleted'

  switch (action) {
    case 'merge':     return 'applied'
    case 'branch':    return 'created version'
    case 'comment':   return 'commented on'
    case 'upload':    return 'uploaded'
    case 'structure': return 'submitted'
    case 'resource':  return 'added'
    case 'resource_update': return 'updated'
    case 'meta':      return 'updated'
    case 'export':    return 'exported'
    default:          return action
  }
}

export type ActivityDescriptionPart = { text: string; emphasis?: boolean }

/** Text segments after @username in band activity rows. */
export function activityDescriptionParts(
  action: string,
  subject: string,
  detail?: string | null,
  projectName?: string | null,
): ActivityDescriptionPart[] {
  if (action === 'comment_remove') {
    const parts: ActivityDescriptionPart[] = [
      { text: 'deleted comment in ' },
      { text: `'${subject}'`, emphasis: true },
    ]
    if (detail) parts.push({ text: ` at ${detail}` })
    return parts
  }

  if (action === 'comment') {
    const parts: ActivityDescriptionPart[] = [
      { text: 'commented on ' },
      { text: subject, emphasis: true },
    ]
    if (detail) parts.push({ text: ` · ${detail}` })
    return parts
  }

  const parts: ActivityDescriptionPart[] = [
    { text: `${activityVerb(action)} ` },
    { text: subject, emphasis: true },
  ]
  if (detail) parts.push({ text: ` · ${detail}` })
  if (action !== 'comment' && action !== 'comment_remove' && projectName) {
    parts.push({ text: ` · ${projectName}` })
  }
  return parts
}

export function formatActivityLine(
  action: string,
  subject: string,
  detail?: string | null,
  projectName?: string | null,
): string {
  const proj = action !== 'comment' && action !== 'comment_remove' && projectName ? ` · ${projectName}` : ''
  if (isDeleteAction(action)) {
    if (action === 'project_remove') return `project '${subject}' deleted`
    if (action === 'comment_remove') {
      return detail
        ? `deleted comment in '${subject}' at ${detail}`
        : `deleted comment in '${subject}'`
    }
    return (detail ? `${subject} · ${detail}` : subject) + proj
  }

  switch (action) {
    case 'merge':
      return subject.replace(' → ', ' applied to ') + proj
    case 'branch':
      return `version '${subject}' created` + proj
    case 'comment':
      return detail ? `comment in '${subject}' at ${detail}` : `comment in '${subject}'`
    case 'upload':
      return (detail ? `${subject} · ${detail} uploaded` : `${subject} uploaded`) + proj
    case 'structure':
      return `${subject}${detail ? ` · ${detail}` : ''}${proj}`
    case 'resource':
      return detail ? `${subject} · ${detail}${proj}` : `${subject}${proj}`
    case 'resource_update':
      return detail ? `${subject} · ${detail}${proj}` : `${subject}${proj}`
    case 'meta':
      return detail ? `${subject} → ${detail}${proj}` : `${subject}${proj}`
    case 'export':
      return `${subject} exported` + proj
    default:
      return subject + proj
  }
}
