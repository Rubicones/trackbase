'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { UpgradeModal, type UpgradeSource } from '@/components/UpgradeModal'

interface UpgradeContextValue {
  openUpgradeModal: (source: UpgradeSource) => void
}

const UpgradeContext = createContext<UpgradeContextValue>({
  openUpgradeModal: () => {},
})

export function useUpgrade() {
  return useContext(UpgradeContext)
}

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; source: UpgradeSource }>({
    open: false,
    source: 'avatar_menu',
  })

  function openUpgradeModal(source: UpgradeSource) {
    setState({ open: true, source })
  }

  function closeModal() {
    setState(s => ({ ...s, open: false }))
  }

  return (
    <UpgradeContext.Provider value={{ openUpgradeModal }}>
      {children}
      {state.open && (
        <UpgradeModal source={state.source} onClose={closeModal} />
      )}
    </UpgradeContext.Provider>
  )
}
