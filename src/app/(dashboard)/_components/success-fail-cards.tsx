import { fmtMoney } from "@/lib/format"

interface SuccessFailCardsProps {
  wonCount: number
  lostCount: number
  wonAmount: number
  lostAmount: number
}

export function SuccessFailCards({
  wonCount,
  lostCount,
  wonAmount,
  lostAmount,
}: SuccessFailCardsProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-2.5">
      {/* Success */}
      <div className="rounded-[10px] border border-border-default border-l-2 border-l-status-green bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Успех
        </div>
        <div className="text-[32px] font-extrabold leading-none tracking-[-0.04em]">
          {wonCount}
        </div>
        <div className="mt-2 text-[13px] text-text-secondary">
          Общая сумма <strong>{fmtMoney(wonAmount)}</strong>
        </div>
      </div>

      {/* Failure */}
      <div className="rounded-[10px] border border-border-default border-l-2 border-l-status-red bg-surface-1 p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:border-border-hover hover:shadow-[var(--card-shadow-hover)]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          Провал
        </div>
        <div className="text-[32px] font-extrabold leading-none tracking-[-0.04em] text-status-red">
          {lostCount}
        </div>
        <div className="mt-2 text-[13px] text-text-secondary">
          Сумма потерь <strong>{fmtMoney(lostAmount)}</strong>
        </div>
      </div>
    </div>
  )
}
