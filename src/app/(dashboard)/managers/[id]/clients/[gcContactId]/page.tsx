import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { requireTenantId } from "@/lib/auth"
import { getCrmProvider } from "@/lib/queries/active-window"
import { getClientDetailGc } from "@/lib/queries/client-detail-gc"
import { ClientCard } from "../../../../_components/gc/client-card"

export const dynamic = "force-dynamic"

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string; gcContactId: string }>
}) {
  const { id: managerId, gcContactId } = await params
  const tenantId = await requireTenantId()

  const provider = await getCrmProvider(tenantId)
  if (provider !== "GETCOURSE") {
    redirect(`/managers/${managerId}`)
  }

  const detail = await getClientDetailGc(tenantId, managerId, gcContactId)
  if (!detail) notFound()

  return (
    <div className="space-y-6 p-6">
      <nav className="text-[12px] text-text-tertiary">
        <Link href="/" className="hover:text-text-secondary">
          🏠 Дашборд
        </Link>
        <span className="mx-1.5">›</span>
        <Link href="/managers" className="hover:text-text-secondary">
          Менеджеры
        </Link>
        <span className="mx-1.5">›</span>
        <Link
          href={`/managers/${managerId}`}
          className="hover:text-text-secondary"
        >
          {detail.managerName ?? "МОП"}
        </Link>
        <span className="mx-1.5">›</span>
        <span>
          {detail.clientName ||
            (detail.clientPhone ? `тел. ***${detail.clientPhone.slice(-4)}` : "Клиент")}
        </span>
      </nav>
      <ClientCard detail={detail} />
    </div>
  )
}
