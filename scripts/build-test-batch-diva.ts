/**
 * Generate test batch JSONL for Intelion pipeline v2 — picks diverse calls from diva.
 *
 * What it picks:
 *   - 10 свежих звонков diva с onPBX (всё стерео с 10.04)
 *   - Разные длительности: короткие (1-3 мин) + средние (5-15 мин) + длинные (>15 мин)
 *   - Только реальные разговоры (user_talk_time > 0)
 *
 * Output: /tmp/test-batch.jsonl с {id, url, dur} per line — для прогона на Intelion
 *
 * Usage:
 *   tsx scripts/build-test-batch-diva.ts > /tmp/test-batch.jsonl
 *
 * NOTE: для diva URL нужно сгенерировать через onlinePBX `mongo_history/search.json`
 * с download=1. Этот скрипт вытаскивает 10 uuid'ов из onPBX history и генерит
 * download URLs (live 30 мин — успеть запустить).
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const ON_PBX_KEY_ID = process.env.ON_PBX_KEY_ID!  // from /auth.json earlier
const ON_PBX_KEY = process.env.ON_PBX_KEY!
const ON_PBX_DOMAIN = "pbx1720.onpbx.ru"
const ON_PBX_BASE = `https://api.onlinepbx.ru/${ON_PBX_DOMAIN}`

if (!ON_PBX_KEY_ID || !ON_PBX_KEY) {
  console.error("Set env ON_PBX_KEY_ID and ON_PBX_KEY (from /auth.json with auth_key=clFw...)")
  process.exit(1)
}

interface OnPbxCall {
  uuid: string
  caller_id_number: string
  destination_number: string
  start_stamp: number
  duration: number
  user_talk_time: number
  hangup_cause: string
}

async function listCalls(from: number, to: number): Promise<OnPbxCall[]> {
  const body = new URLSearchParams({
    limit: "100",
    start_stamp_from: String(from),
    start_stamp_to: String(to),
  })
  const r = await fetch(`${ON_PBX_BASE}/mongo_history/search.json`, {
    method: "POST",
    headers: {
      "x-pbx-authentication": `${ON_PBX_KEY_ID}:${ON_PBX_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })
  const json = (await r.json()) as { status: string; data: OnPbxCall[] }
  return json.data ?? []
}

async function getRecordUrl(uuid: string): Promise<string | null> {
  const body = new URLSearchParams({ uuid, download: "1" })
  const r = await fetch(`${ON_PBX_BASE}/mongo_history/search.json`, {
    method: "POST",
    headers: {
      "x-pbx-authentication": `${ON_PBX_KEY_ID}:${ON_PBX_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })
  const json = (await r.json()) as { status: string; data: string }
  return typeof json.data === "string" ? json.data : null
}

function pickDiverse(calls: OnPbxCall[]): OnPbxCall[] {
  // Take only real talks
  const real = calls.filter((c) => c.user_talk_time > 30)
  // Bucket by duration: short (<3min), medium (3-10min), long (>10min)
  const short = real.filter((c) => c.duration < 180).slice(0, 3)
  const medium = real.filter((c) => c.duration >= 180 && c.duration < 600).slice(0, 4)
  const long = real.filter((c) => c.duration >= 600).slice(0, 3)
  return [...short, ...medium, ...long]
}

async function main() {
  const now = Math.floor(Date.now() / 1000)
  const weekAgo = now - 7 * 86400

  console.error(`Fetching diva onPBX calls last 7 days...`)
  const calls = await listCalls(weekAgo, now)
  console.error(`Got ${calls.length} calls`)

  const picked = pickDiverse(calls)
  console.error(`Picked ${picked.length} diverse calls (3 short + 4 medium + 3 long)`)

  for (const call of picked) {
    const url = await getRecordUrl(call.uuid)
    if (!url) {
      console.error(`  skip ${call.uuid}: no download url`)
      continue
    }
    const out = {
      id: call.uuid,
      url,
      dur: call.duration,
      manager_ext: call.caller_id_number,
      client_phone: call.destination_number,
    }
    console.log(JSON.stringify(out))
    console.error(`  ✅ ${call.uuid} dur=${call.duration}s ext=${call.caller_id_number}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
