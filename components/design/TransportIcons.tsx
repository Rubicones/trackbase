import { Metronome } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'

export function MetronomeIcon({ className, size = 16 }: { className?: string; size?: number }) {
  return <LucideIcon icon={Metronome} size={size} className={className} />
}

export function CountInMark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-mono text-[9px] font-bold tracking-tight tabular-nums leading-none px-1 ${className}`}>
      1..2..
    </span>
  )
}
