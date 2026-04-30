import { Header } from "@/components/header"
import { requireAuth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getCrmProvider } from "@/lib/queries/active-window"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireAuth()
  const tenantId = session.user.tenantId
  const tenant = tenantId
    ? await db.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      })
    : null
  const provider = tenantId ? await getCrmProvider(tenantId) : null
  return (
    <>
      <Header tenantName={tenant?.name ?? "—"} crmProvider={provider} />
      <main className="mx-auto max-w-[1120px] px-6 py-8 pb-20">
        {children}
      </main>
    </>
  )
}
