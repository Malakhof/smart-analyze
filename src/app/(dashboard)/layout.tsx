import { Header } from "@/components/header"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1120px] px-6 py-8 pb-20">
        {children}
      </main>
    </>
  )
}
