import Link from 'next/link'

type SonicdeskWordmarkProps = {
  href?: string
  className?: string
}

export function SonicdeskWordmark({
  href,
  className = 'text-lg md:text-xl lg:text-2xl',
}: SonicdeskWordmarkProps) {
  const shellClass = `font-display font-bold tracking-tight text-lime shrink-0 ${className}`

  if (href) {
    return (
      <Link href={href} className={`${shellClass} no-underline`}>
        sonicdesk.
      </Link>
    )
  }

  return <span className={shellClass}>sonicdesk.</span>
}
