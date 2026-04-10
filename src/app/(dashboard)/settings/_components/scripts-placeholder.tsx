"use client"

export function ScriptsPlaceholder() {
  return (
    <div>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
        Скрипты контроля качества
      </h2>
      <p className="mb-6 text-[13px] text-text-secondary">
        Создание и управление чеклистами для оценки звонков.
      </p>

      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border-default bg-surface-1 px-8 py-16 text-center">
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white"
          style={{ background: "var(--ai-grad)" }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 fill-none stroke-current"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div className="mb-2 text-[15px] font-semibold text-text-primary">
          Раздел в разработке
        </div>
        <div className="max-w-[320px] text-[13px] text-text-tertiary">
          Здесь можно будет создавать скрипты с чеклистами для автоматической
          оценки качества звонков менеджеров.
        </div>
      </div>
    </div>
  )
}
