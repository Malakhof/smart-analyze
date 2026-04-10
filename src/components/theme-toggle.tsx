"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button
        className="relative h-5 w-9 cursor-pointer rounded-[10px] border border-border-default bg-surface-3 transition-[background,border-color] duration-[0.18s] ease-in-out hover:border-border-hover"
        aria-label="Toggle theme"
      />
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="relative h-5 w-9 cursor-pointer rounded-[10px] border border-border-default bg-surface-3 transition-[background,border-color] duration-[0.18s] ease-in-out hover:border-border-hover"
      aria-label="Toggle theme"
      title="Переключить тему"
    >
      <span
        className={`absolute top-[2px] left-[2px] h-3.5 w-3.5 rounded-full bg-text-primary transition-transform duration-[0.18s] ease-in-out ${
          theme === "light" ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  )
}
