import { Header } from "@/components/header"
import { requireAuth } from "@/lib/auth"
import { db } from "@/lib/db"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireAuth()
  const tenant = session.user.tenantId
    ? await db.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { name: true },
      })
    : null
  return (
    <>
      <Header tenantName={tenant?.name ?? "—"} />
      <main className="mx-auto max-w-[1120px] px-6 py-8 pb-20">
        {children}
      </main>
    </>
  )
}
