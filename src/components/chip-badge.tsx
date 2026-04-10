import Link from "next/link"

interface ChipBadgeProps {
  label: string
  href: string
}

export function ChipBadge({ label, href }: ChipBadgeProps) {
  return (
    <Link
      href={href}
      className="inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
    >
      {label}
    </Link>
  )
}
