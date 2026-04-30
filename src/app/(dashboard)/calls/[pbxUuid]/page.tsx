import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { requireTenantId } from "@/lib/auth"
import { getCrmProvider } from "@/lib/queries/active-window"
import {
  classifyCallType,
  getCallDetailByPbxUuid,
} from "@/lib/queries/call-detail-gc"
import { CallCard } from "../../_components/gc/call-card"

export const dynamic = "force-dynamic"

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ pbxUuid: string }>
}) {
  const { pbxUuid } = await params
  const tenantId = await requireTenantId()

  // GC-only route — для amoCRM tenants редиректим на старую страницу.
  const provider = await getCrmProvider(tenantId)
  if (provider !== "GETCOURSE") {
    redirect("/quality")
  }

  const call = await getCallDetailByPbxUuid(tenantId, pbxUuid)
  if (!call) notFound()

  const type = classifyCallType(call)

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/quality"
        className="inline-block text-[13px] text-text-tertiary hover:text-text-secondary"
      >
        ← К списку звонков
      </Link>
      <CallCard call={call} type={type} />
    </div>
  )
}
