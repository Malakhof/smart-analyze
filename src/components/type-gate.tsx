import type { ReactNode } from "react"
import type { CallType } from "@/lib/queries/call-detail-gc"

export function TypeGate({ showFor, currentType, children }: {
  showFor: CallType[]
  currentType: CallType
  children: ReactNode
}): ReactNode {
  return showFor.includes(currentType) ? <>{children}</> : null
}
