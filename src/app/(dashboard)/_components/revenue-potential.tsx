import { fmtMoney, fmtPercent } from "@/lib/format"

interface RevenuePotentialProps {
  totalPotential: number
  wonAmount: number
  lostAmount: number
  lossPercent: number
}

export function RevenuePotential({
  totalPotential,
  wonAmount,
  lostAmount,
  lossPercent,
}: RevenuePotentialProps) {
  return (
    <div className="relative mb-8 overflow-hidden rounded-[14px] border border-border-default bg-surface-1 px-10 py-10 text-center shadow-[var(--card-shadow)]">
      {/* AI glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-[-100px] h-[200px] w-[400px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse, var(--ai-glow) 0%, transparent 70%)",
        }}
      />

      <div className="relative mb-2 text-[13px] text-text-tertiary">
        Потенциал роста выручки
      </div>
      <div className="relative mb-8 text-[52px] font-extrabold leading-none tracking-[-0.05em]">
        <span className="ai-grad">{fmtMoney(totalPotential)}</span>
      </div>

      <div className="relative mb-6 flex justify-center gap-14">
        <div>
          <div className="mb-1 text-[11px] font-medium text-text-tertiary">
            Получено
          </div>
          <div className="text-[18px] font-bold tracking-[-0.02em] text-status-green">
            {fmtMoney(wonAmount)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-text-tertiary">
            Потеряно
          </div>
          <div className="text-[18px] font-bold tracking-[-0.02em] text-status-red">
            {fmtMoney(lostAmount)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium text-text-tertiary">
            Потери
          </div>
          <div className="text-[18px] font-bold tracking-[-0.02em] text-status-amber">
            {fmtPercent(lossPercent)}
          </div>
        </div>
      </div>

      <div className="relative inline-block rounded-[6px] bg-surface-3 px-6 py-2.5 text-[13px] text-text-secondary">
        Устранив провалы, отдел увеличит выручку на{" "}
        <strong>{fmtMoney(lostAmount)}</strong>
      </div>
    </div>
  )
}
