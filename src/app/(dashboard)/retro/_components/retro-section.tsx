import type { ReactNode } from "react"

interface RetroSectionProps {
  title: string
  subtitle?: string
  children: ReactNode
}

/**
 * Consistent vertical rhythm + section header for the long retro narrative.
 * Each block on /retro is wrapped in this so the page reads as one story
 * instead of a jumble of widgets.
 */
export function RetroSection({ title, subtitle, children }: RetroSectionProps) {
  return (
    <section className="mt-12 mb-12 border-t border-border-default pt-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-[13px] text-text-secondary">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  )
}
