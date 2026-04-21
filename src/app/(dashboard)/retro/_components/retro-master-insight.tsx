"use client"

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import type { InsightWithDetails } from "@/lib/queries/dashboard"

interface Section {
  title: string
  body: string
}

/**
 * Split markdown into sections by `### emoji Title` headers.
 * Returns ordered array of {title, body} where body is markdown without the H3.
 */
function parseSections(md: string): Section[] {
  const lines = md.split(/\r?\n/)
  const sections: Section[] = []
  let current: Section | null = null
  let intro = ""

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (current) sections.push(current)
      current = { title: line.slice(4).trim(), body: "" }
    } else if (line.startsWith("# ")) {
      // skip top-level h1
      continue
    } else {
      if (current) current.body += line + "\n"
      else intro += line + "\n"
    }
  }
  if (current) sections.push(current)

  // If no sections found — wrap the whole thing as one
  if (sections.length === 0) {
    return [{ title: "Полный текст", body: md }]
  }
  // If we had intro before first section — prepend as "Введение"
  if (intro.trim().length > 30) {
    return [{ title: "Введение", body: intro.trim() }, ...sections]
  }
  return sections
}

/** Главный вывод аудита — outer accordion + nested 5 sub-accordions per section. */
export function RetroMasterInsight({
  insight,
}: {
  insight: InsightWithDetails
}) {
  const text = insight.detailedDescription ?? insight.content
  const sections = parseSections(text)

  return (
    <div className="overflow-hidden rounded-xl border-2 border-status-purple-border bg-gradient-to-br from-purple-500/5 via-pink-500/5 to-transparent shadow-lg">
      <Accordion>
        <AccordionItem value="master" className="border-0">
          <AccordionTrigger className="w-full px-6 py-5 text-left hover:no-underline hover:bg-surface-2/30">
            <div className="flex flex-1 items-center gap-3">
              <span className="text-[24px]">📋</span>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.05em] text-status-purple">
                  Финальный вывод аудита
                </div>
                <div className="mt-0.5 text-[20px] font-extrabold tracking-[-0.01em] text-text-primary">
                  90 дней работы школы — что мы нашли
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-2 pb-2">
            <Accordion>
              {sections.map((s, i) => (
                <AccordionItem
                  key={i}
                  value={`s-${i}`}
                  className="border-t border-border-default/50"
                >
                  <AccordionTrigger className="w-full px-4 py-3 text-left text-[14px] font-semibold text-text-primary hover:no-underline hover:bg-surface-2/40">
                    {s.title}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <Md text={s.body.trim()} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function Md({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  return (
    <div className="space-y-1.5 text-[13.5px] leading-[1.65] text-text-primary">
      {lines.map((line, i) => {
        if (line.startsWith("- ") || line.startsWith("• "))
          return (
            <div key={i} className="ml-3">
              • {renderBold(line.slice(2))}
            </div>
          )
        if (/^\d+\.\s/.test(line))
          return (
            <div key={i} className="ml-3">
              {renderBold(line)}
            </div>
          )
        if (line.trim() === "") return <div key={i} className="h-1.5" />
        return <div key={i}>{renderBold(line)}</div>
      })}
    </div>
  )
}

function renderBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-text-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}
