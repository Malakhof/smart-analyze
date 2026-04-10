"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface TooltipMetricProps {
  text: string
}

export function TooltipMetric({ text }: TooltipMetricProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className="ml-1 inline-flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full border border-border-default text-[9px] text-text-tertiary transition-colors hover:border-border-hover hover:text-text-secondary"
        >
          i
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
