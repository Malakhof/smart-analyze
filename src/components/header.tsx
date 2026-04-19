"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AiBadge } from "@/components/ai-badge"
import { ThemeToggle } from "@/components/theme-toggle"

const NAV_ITEMS = [
  { label: "Главная", href: "/" },
  { label: "Менеджеры", href: "/managers" },
  { label: "Паттерны", href: "/patterns" },
  { label: "Контроль качества", href: "/quality" },
  { label: "Настройки", href: "/settings" },
] as const

export function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 flex h-[52px] items-center gap-8 border-b border-border-default bg-header-bg px-8 backdrop-blur-[20px]">
      {/* Logo — Sales GURU (Чернобай) с лёгкой анимацией лапы */}
      <Link href="/" className="group flex items-center gap-2.5 no-underline">
        <span className="block h-9 w-9 overflow-hidden rounded-full bg-surface-2 transition-transform duration-300 ease-in-out group-hover:rotate-[15deg]">
          <Image
            src="/sg-logo.png"
            alt="Sales GURU"
            width={36}
            height={36}
            className="h-full w-full object-cover"
            unoptimized
            priority
          />
        </span>
        <span className="flex flex-col leading-none tracking-[0.04em]">
          <span className="text-[14px] font-extrabold text-text-primary">
            Sales
          </span>
          <span
            className="text-[14px] font-extrabold"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #6366f1, #a855f7 50%, #ec4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            GURU
          </span>
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex gap-0">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative px-3.5 py-[15px] text-[13px] font-medium transition-colors duration-[0.18s] ease-in-out ${
                isActive
                  ? "text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  className="absolute bottom-[-1px] left-2 right-2 h-0.5 rounded-[1px]"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--ai-1), var(--ai-2))",
                  }}
                />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 fill-none stroke-text-tertiary"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Поиск..."
          className="h-[30px] w-[180px] rounded-md border border-border-default bg-transparent pl-8 pr-3 font-sans text-[12px] text-text-primary placeholder:text-text-tertiary outline-none transition-[border-color] duration-[0.18s] ease-in-out focus:border-border-hover"
          readOnly
        />
      </div>

      {/* AI badge */}
      <AiBadge text="AI активен" />

      {/* Theme toggle */}
      <ThemeToggle />

      {/* Org button */}
      <button className="cursor-pointer rounded-md border border-border-default bg-transparent px-2.5 py-[5px] font-sans text-xs text-text-tertiary transition-[border-color] duration-[0.18s] ease-in-out hover:border-border-hover">
        Организация
      </button>

      {/* Logout */}
      <a
        href="/api/auth/signout"
        className="cursor-pointer rounded-md border border-border-default bg-transparent px-2.5 py-[5px] font-sans text-xs text-text-tertiary no-underline transition-[border-color] duration-[0.18s] ease-in-out hover:border-border-hover hover:text-text-secondary"
        title="Выйти"
      >
        Выйти
      </a>
    </header>
  )
}
