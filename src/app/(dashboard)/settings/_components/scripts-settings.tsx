"use client"

import { useState, useEffect, useCallback } from "react"

interface ScriptItemData {
  id?: string
  text: string
  weight: number
  isCritical: boolean
  order: number
}

interface ScriptData {
  id: string
  name: string
  category: string | null
  isActive: boolean
  items: ScriptItemData[]
}

const CATEGORIES = [
  { value: "incoming", label: "Входящий" },
  { value: "outgoing", label: "Исходящий" },
  { value: "upsell", label: "Допродажа" },
]

const WEIGHTS = [0.5, 1.0, 1.5, 2.0]

function categoryLabel(category: string | null): string {
  if (!category) return "Без категории"
  const found = CATEGORIES.find((c) => c.value === category)
  return found ? found.label : category
}

export function ScriptsSettings() {
  const [scripts, setScripts] = useState<ScriptData[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ScriptData | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  const fetchScripts = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/scripts")
      if (!res.ok) return
      const data = await res.json()
      setScripts(data.scripts || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScripts()
  }, [fetchScripts])

  function handleCreate() {
    setEditing({
      id: "",
      name: "",
      category: "incoming",
      isActive: true,
      items: [
        { text: "", weight: 1.0, isCritical: false, order: 0 },
      ],
    })
    setIsNew(true)
    setMessage(null)
  }

  function handleEdit(script: ScriptData) {
    setEditing({ ...script, items: script.items.map((i) => ({ ...i })) })
    setIsNew(false)
    setMessage(null)
  }

  function handleCancel() {
    setEditing(null)
    setIsNew(false)
  }

  function handleItemChange(
    index: number,
    field: keyof ScriptItemData,
    value: string | number | boolean,
  ) {
    if (!editing) return
    const items = [...editing.items]
    items[index] = { ...items[index], [field]: value }
    setEditing({ ...editing, items })
  }

  function handleAddItem() {
    if (!editing) return
    setEditing({
      ...editing,
      items: [
        ...editing.items,
        {
          text: "",
          weight: 1.0,
          isCritical: false,
          order: editing.items.length,
        },
      ],
    })
  }

  function handleRemoveItem(index: number) {
    if (!editing || editing.items.length <= 1) return
    const items = editing.items
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, order: i }))
    setEditing({ ...editing, items })
  }

  function handleMoveItem(index: number, direction: "up" | "down") {
    if (!editing) return
    const items = [...editing.items]
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= items.length) return

    const temp = items[index]
    items[index] = items[targetIndex]
    items[targetIndex] = temp

    const reordered = items.map((item, i) => ({ ...item, order: i }))
    setEditing({ ...editing, items: reordered })
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.name.trim()) {
      setMessage({ type: "error", text: "Укажите название скрипта" })
      return
    }
    if (editing.items.some((i) => !i.text.trim())) {
      setMessage({ type: "error", text: "Заполните все пункты чеклиста" })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const payload = {
        ...(isNew ? {} : { id: editing.id }),
        name: editing.name,
        category: editing.category,
        isActive: editing.isActive,
        items: editing.items.map((item, i) => ({
          text: item.text,
          weight: item.weight,
          isCritical: item.isCritical,
          order: i,
        })),
      }

      const res = await fetch("/api/settings/scripts", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: "error", text: data.error || "Ошибка сохранения" })
        return
      }

      setMessage({ type: "success", text: isNew ? "Скрипт создан" : "Скрипт обновлён" })
      setEditing(null)
      setIsNew(false)
      await fetchScripts()
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить скрипт?")) return
    try {
      const res = await fetch(`/api/settings/scripts?id=${id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        await fetchScripts()
        setMessage({ type: "success", text: "Скрипт удалён" })
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка удаления" })
    }
  }

  async function handleToggleActive(script: ScriptData) {
    try {
      const res = await fetch("/api/settings/scripts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: script.id,
          name: script.name,
          category: script.category,
          isActive: !script.isActive,
          items: script.items.map((item) => ({
            text: item.text,
            weight: item.weight,
            isCritical: item.isCritical,
            order: item.order,
          })),
        }),
      })
      if (res.ok) {
        await fetchScripts()
      }
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">
            Скрипты контроля качества
          </h2>
          <p className="text-[13px] text-text-secondary">
            Создание и управление чеклистами для оценки звонков.
          </p>
        </div>
        {!editing && (
          <button
            onClick={handleCreate}
            className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity"
            style={{ background: "var(--ai-grad)" }}
          >
            Создать скрипт
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mb-4 rounded-[6px] border px-3 py-2 text-[13px] ${
            message.type === "success"
              ? "border-status-green-border bg-status-green-dim text-status-green"
              : "border-status-red-border bg-status-red-dim text-status-red"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div className="mb-6 rounded-[10px] border border-border-default bg-surface-2 p-5">
          <h3 className="mb-4 text-[15px] font-semibold">
            {isNew ? "Новый скрипт" : "Редактирование скрипта"}
          </h3>

          {/* Name */}
          <div className="mb-4 max-w-md">
            <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
              Название
            </label>
            <input
              type="text"
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.target.value })
              }
              placeholder="Скрипт входящего звонка"
              className="w-full rounded-[6px] border border-border-default bg-surface-1 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
            />
          </div>

          {/* Category */}
          <div className="mb-4 max-w-md">
            <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
              Категория
            </label>
            <select
              value={editing.category || ""}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  category: e.target.value || null,
                })
              }
              className="w-full rounded-[6px] border border-border-default bg-surface-1 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
            >
              <option value="">Без категории</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div className="mb-4">
            <label className="mb-2 block text-[12px] font-medium text-text-secondary">
              Пункты чеклиста
            </label>
            <div className="space-y-2">
              {editing.items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-[6px] border border-border-default bg-surface-1 p-2"
                >
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, "up")}
                      disabled={index === 0}
                      className="cursor-pointer text-[10px] text-text-tertiary transition-colors hover:text-text-primary disabled:opacity-30"
                      title="Вверх"
                    >
                      &#9650;
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, "down")}
                      disabled={index === editing.items.length - 1}
                      className="cursor-pointer text-[10px] text-text-tertiary transition-colors hover:text-text-primary disabled:opacity-30"
                      title="Вниз"
                    >
                      &#9660;
                    </button>
                  </div>

                  {/* Order number */}
                  <span className="w-5 text-center text-[12px] text-text-tertiary">
                    {index + 1}
                  </span>

                  {/* Text */}
                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) =>
                      handleItemChange(index, "text", e.target.value)
                    }
                    placeholder="Описание пункта скрипта"
                    className="min-w-0 flex-1 rounded-[4px] border border-border-default bg-surface-2 px-2 py-1.5 text-[13px] text-text-primary outline-none transition-colors focus:border-ai-1"
                  />

                  {/* Weight */}
                  <select
                    value={item.weight}
                    onChange={(e) =>
                      handleItemChange(
                        index,
                        "weight",
                        parseFloat(e.target.value),
                      )
                    }
                    className="w-16 rounded-[4px] border border-border-default bg-surface-2 px-1 py-1.5 text-[12px] text-text-primary outline-none"
                    title="Вес"
                  >
                    {WEIGHTS.map((w) => (
                      <option key={w} value={w}>
                        x{w}
                      </option>
                    ))}
                  </select>

                  {/* Critical toggle */}
                  <label
                    className="flex cursor-pointer items-center gap-1 text-[11px] text-text-secondary"
                    title="Критичный пункт (алерт в Telegram при пропуске)"
                  >
                    <input
                      type="checkbox"
                      checked={item.isCritical}
                      onChange={(e) =>
                        handleItemChange(index, "isCritical", e.target.checked)
                      }
                      className="accent-[var(--status-red)]"
                    />
                    Крит.
                  </label>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    disabled={editing.items.length <= 1}
                    className="cursor-pointer text-[14px] text-text-tertiary transition-colors hover:text-status-red disabled:opacity-30"
                    title="Удалить пункт"
                  >
                    &#10005;
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddItem}
              className="mt-2 cursor-pointer text-[13px] font-medium text-ai-1 transition-opacity hover:opacity-80"
            >
              + Добавить пункт
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--ai-grad)" }}
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
            <button
              onClick={handleCancel}
              className="cursor-pointer rounded-[6px] border border-border-default bg-transparent px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Scripts list */}
      {loading ? (
        <div className="py-8 text-center text-[13px] text-text-tertiary">
          Загрузка...
        </div>
      ) : scripts.length === 0 && !editing ? (
        <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border-default bg-surface-1 px-8 py-16 text-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white"
            style={{ background: "var(--ai-grad)" }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 fill-none stroke-current"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="mb-2 text-[15px] font-semibold text-text-primary">
            Нет скриптов
          </div>
          <div className="mb-4 max-w-[320px] text-[13px] text-text-tertiary">
            Создайте первый скрипт с чеклистом для автоматической оценки
            качества звонков.
          </div>
          <button
            onClick={handleCreate}
            className="cursor-pointer rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity"
            style={{ background: "var(--ai-grad)" }}
          >
            Создать скрипт
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="flex items-center justify-between rounded-[10px] border border-border-default bg-surface-2 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-text-primary">
                    {script.name}
                  </span>
                  <span className="rounded-[4px] bg-surface-1 px-2 py-0.5 text-[11px] text-text-tertiary">
                    {categoryLabel(script.category)}
                  </span>
                  <span className="text-[11px] text-text-tertiary">
                    {script.items.length}{" "}
                    {script.items.length === 1 ? "пункт" : "пунктов"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Active toggle */}
                <button
                  onClick={() => handleToggleActive(script)}
                  className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    script.isActive
                      ? "bg-status-green-dim text-status-green"
                      : "bg-surface-1 text-text-tertiary"
                  }`}
                >
                  {script.isActive ? "Активен" : "Выключен"}
                </button>

                {/* Edit */}
                <button
                  onClick={() => handleEdit(script)}
                  className="cursor-pointer text-[13px] text-text-secondary transition-colors hover:text-text-primary"
                >
                  Редактировать
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(script.id)}
                  className="cursor-pointer text-[13px] text-text-tertiary transition-colors hover:text-status-red"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
