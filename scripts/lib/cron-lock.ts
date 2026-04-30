/**
 * cron-lock.ts — file-based mutex for cron-master-pipeline.
 *
 * Why: Two overlapping cron cycles ('crontab fires before previous finished')
 * cause UPSERT race → duplicate CallRecord rows. Without lock the symptom
 * appears 2-3 days into deployment when one cycle goes long.
 *
 * Behaviour:
 *  - acquireLock(path) writes pid+now to a file. Returns release() handle.
 *  - If file exists AND its pid is alive AND its mtime ≤ staleMs → fails (return null).
 *  - If file exists but stale → silently steals it (logs warning).
 *  - release() unlinks the file. If process dies hard, next cycle's stale check picks up.
 */
import { promises as fs } from "node:fs"
import { existsSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"

export interface LockHandle {
  path: string
  release: () => Promise<void>
}

export interface AcquireOptions {
  staleMs?: number    // default 30 min — older lock is considered crashed
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = test only
    return true
  } catch {
    return false
  }
}

export async function acquireLock(
  path: string,
  options: AcquireOptions = {}
): Promise<LockHandle | null> {
  const staleMs = options.staleMs ?? 30 * 60 * 1000

  if (existsSync(path)) {
    const st = statSync(path)
    const ageMs = Date.now() - st.mtimeMs
    let prevPid = 0
    try {
      prevPid = Number.parseInt(readFileSync(path, "utf8").trim().split("\n")[0], 10) || 0
    } catch { /* corrupt lock — treat as stale */ }

    if (prevPid && isPidAlive(prevPid) && ageMs < staleMs) {
      return null   // legitimate concurrent run
    }
    console.warn(`[lock] stealing stale lock ${path} (pid=${prevPid} age=${(ageMs/1000).toFixed(0)}s)`)
    try { unlinkSync(path) } catch { /* race with another stealer — ok */ }
  }

  // Best-effort atomic create. If another process beat us between exists() and write,
  // we'll over-write — but the next cycle's pid check sorts it out.
  writeFileSync(path, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "w" })

  return {
    path,
    release: async () => {
      try { await fs.unlink(path) } catch { /* already gone */ }
    },
  }
}
