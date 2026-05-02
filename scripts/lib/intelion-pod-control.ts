/**
 * intelion-pod-control.ts — typed Intelion API client + watchdog.
 *
 * Used by whisper-worker daemon to:
 *   - start a pod when there's pending work AND cost cap allows
 *   - stop a pod when work is done OR cost cap is hit
 *   - watchdog: every 25 min ping pod_status; if 'silently_died' restart
 *     (canon feedback-intelion-auto-renewal-bug.md)
 *
 * Status codes (observed on Intelion):
 *   2  → running
 *   1  → booting
 *  -1  → stopped / silently_died
 *   0  → paused (free, kept image)
 */
import type { PrismaClient } from "../../src/generated/prisma/client"

export interface PodInfo {
  id: number
  status: number
  ip: string | null
  domain: string | null
}

const API_BASE = "https://intelion.cloud"

function authHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Token ${token}`,
    "Content-Type":  "application/json",
  }
}

export async function getPodStatus(token: string, podId: number): Promise<PodInfo> {
  const r = await fetch(`${API_BASE}/api/v2/cloud-servers/${podId}/`, {
    headers: authHeaders(token),
  })
  if (!r.ok) throw new Error(`Intelion getPodStatus ${podId}: HTTP ${r.status}`)
  const j = await r.json() as Record<string, unknown>
  return {
    id: podId,
    status: Number(j.status ?? -1),
    ip: typeof j.ip_to_connect === "string" ? j.ip_to_connect : null,
    domain: typeof j.domain_to_connect === "string" ? j.domain_to_connect : null,
  }
}

export async function startPod(token: string, podId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/v2/cloud-servers/${podId}/actions/`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ status: 2 }),
  })
  // 409 = pod already running or in transition — treat as success.
  if (r.status === 409) return
  if (!r.ok) throw new Error(`Intelion startPod ${podId}: HTTP ${r.status}`)
}

export async function stopPod(token: string, podId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/v2/cloud-servers/${podId}/actions/`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ status: -1 }),
  })
  if (!r.ok) throw new Error(`Intelion stopPod ${podId}: HTTP ${r.status}`)
}

/**
 * Wait until pod transitions to running (status=2) or fails after `timeoutMs`.
 * Returns true on ready, false on timeout.
 */
export async function waitPodReady(
  token: string,
  podId: number,
  timeoutMs = 5 * 60 * 1000,
): Promise<PodInfo | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const info = await getPodStatus(token, podId)
    if (info.status === 2 && info.ip) return info
    if (info.status === -1) {
      // silently died — try restart (canon feedback-intelion-auto-renewal-bug)
      await startPod(token, podId)
    }
    await new Promise((r) => setTimeout(r, 15_000))
  }
  return null
}

/**
 * Open / record a GpuRun row for cost tracking. Returns the run id.
 */
export async function openGpuRun(
  db: PrismaClient,
  tenantId: string,
  podId: number,
  ratePerHour: number,
  filesQueued: number,
): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "GpuRun"
       (id, "tenantId", "podId", "startedAt", "ratePerHour", "filesQueued", outcome)
     VALUES (gen_random_uuid()::text, $1, $2, NOW(), $3, $4, 'running')
     RETURNING id`,
    tenantId, String(podId), ratePerHour, filesQueued,
  )
  return rows[0].id
}

export async function closeGpuRun(
  db: PrismaClient,
  runId: string,
  outcome: "completed" | "capped" | "killed" | "silent_stop",
  filesDone: number,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "GpuRun"
     SET "stoppedAt"   = NOW(),
         "filesDone"   = $1,
         "actualCost"  = "ratePerHour" * (EXTRACT(EPOCH FROM NOW() - "startedAt") / 3600),
         outcome       = $2
     WHERE id = $3`,
    filesDone, outcome, runId,
  )
}
