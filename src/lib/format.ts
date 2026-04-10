const ruNumber = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
})

const ruDecimal = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

const ruPercent = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

export function fmtMoney(value: number): string {
  return `${ruNumber.format(Math.round(value))} \u20BD`
}

export function fmtNumber(value: number): string {
  return ruNumber.format(value)
}

export function fmtPercent(value: number): string {
  return `${ruPercent.format(value)}%`
}

export function fmtDays(value: number): string {
  return `${ruDecimal.format(value)} дн`
}
