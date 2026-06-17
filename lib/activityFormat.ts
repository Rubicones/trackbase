/** Shared band-activity display helpers for dashboard + band pages. */

type ActivityColorToken =
  | 'ember'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'foreground'
  | 'muted-foreground'

function activityColorToken(action: string): ActivityColorToken {
  switch (action) {
    case 'merge':
      return 'ember'
    case 'branch':
      return 'chart-3'
    case 'upload':
      return 'chart-2'
    case 'comment':
      return 'chart-5'
    case 'structure':
      return 'chart-4'
    case 'resource':
    case 'resource_update':
    case 'resource_remove':
      return 'chart-4'
    case 'meta':
      return 'chart-4'
    case 'export':
      return 'foreground'
    default:
      return 'muted-foreground'
  }
}

const ACTIVITY_TEXT_CLASS: Record<ActivityColorToken, string> = {
  ember: 'text-ember',
  'chart-2': 'text-chart-2',
  'chart-3': 'text-chart-3',
  'chart-4': 'text-chart-4',
  'chart-5': 'text-chart-5',
  foreground: 'text-foreground',
  'muted-foreground': 'text-muted-foreground',
}

const ACTIVITY_BG_CLASS: Record<ActivityColorToken, string> = {
  ember: 'bg-ember',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
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
  switch (action) {
    case 'merge':     return 'merged'
    case 'branch':    return 'opened branch'
    case 'comment':   return 'commented on'
    case 'upload':    return 'uploaded'
    case 'structure': return 'submitted'
    case 'resource':  return 'added'
    case 'resource_update': return 'updated'
    case 'resource_remove': return 'removed'
    case 'meta':      return 'updated'
    case 'export':    return 'exported'
    default:          return action
  }
}

export function formatActivityLine(
  action: string,
  subject: string,
  detail?: string | null,
  projectName?: string | null,
): string {
  const proj = action !== 'comment' && projectName ? ` · ${projectName}` : ''
  switch (action) {
    case 'merge':
      return subject.replace(' → ', ' merged into ') + proj
    case 'branch':
      return `branch '${subject}' opened` + proj
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
    case 'resource_remove':
      return detail ? `${subject} · ${detail}${proj}` : `${subject}${proj}`
    case 'meta':
      return detail ? `${subject} → ${detail}${proj}` : `${subject}${proj}`
    case 'export':
      return `${subject} exported` + proj
    default:
      return subject + proj
  }
}
