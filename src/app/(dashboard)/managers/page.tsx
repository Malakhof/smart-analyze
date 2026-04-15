import { requireTenantId } from "@/lib/auth"
export const dynamic = "force-dynamic"

import { getManagersList } from "@/lib/queries/managers"
import { ManagerCards } from "./_components/manager-cards"

export default async function ManagersPage() {
  const tenantId = await requireTenantId()

}

function managersWord(n: number): string {
  const lastTwo = n % 100
  const lastOne = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return "менеджеров"
  if (lastOne === 1) return "менеджера"
  if (lastOne >= 2 && lastOne <= 4) return "менеджеров"
  return "менеджеров"
}
