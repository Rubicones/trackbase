const STORAGE_KEY = 'sonicdesk-master-edit-suppress-until'
const SUPPRESS_MS = 24 * 60 * 60 * 1000

export class MasterEditGuardCancelled extends Error {
  constructor() {
    super('Master edit guard cancelled')
    this.name = 'MasterEditGuardCancelled'
  }
}

export function isMasterEditGuardSuppressed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const until = localStorage.getItem(STORAGE_KEY)
    if (!until) return false
    const ts = Number(until)
    if (!Number.isFinite(ts) || Date.now() > ts) {
      localStorage.removeItem(STORAGE_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

export function suppressMasterEditGuard24h(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + SUPPRESS_MS))
  } catch {
    /* ignore quota errors */
  }
}
