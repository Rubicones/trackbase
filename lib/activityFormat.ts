/** Shared band-activity display helpers for dashboard + band pages. */

export function activityDotColor(action: string): string {
  switch (action) {
    case 'merge':            return 'var(--dot-merge)'
    case 'branch':           return 'var(--dot-branch)'
    case 'comment':          return 'var(--dot-comment)'
    case 'upload':           return 'var(--dot-upload)'
    case 'structure':        return 'var(--dot-structure)'
    case 'resource':         return 'var(--dot-resource)'
    case 'resource_update':  return 'var(--dot-resource)'
    case 'resource_remove':  return 'var(--dot-resource)'
    case 'meta':             return 'var(--dot-meta)'
    case 'export':           return 'var(--dot-export)'
    default:                 return 'var(--text-dim)'
  }
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
