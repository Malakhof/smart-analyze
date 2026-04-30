/**
 * disk-cleanup.ts — keep /tmp from filling up over a few days of cron runs.
 *
 * Default policy: delete files older than 24h in given paths, never touch
 * lock files (*.lock) since acquireLock has its own staleness check.
 *
 * Returns counts for telemetry; never throws on individual file failures.
 */
import { promises as fs } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

export interface CleanupOptions {
  paths: string[]
  maxAgeMs?: number          // default 24h
  preserveLockFiles?: boolean // default true — never touch *.lock
  dryRun?: boolean
}

export interface CleanupResult {
  scanned: number
  deleted: number
  bytesFreed: number
  errors: number
}

export async function cleanupOldFiles(opts: CleanupOptions): Promise<CleanupResult> {
  const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60 * 1000
  const preserveLocks = opts.preserveLockFiles !== false
  const cutoff = Date.now() - maxAgeMs
  const result: CleanupResult = { scanned: 0, deleted: 0, bytesFreed: 0, errors: 0 }

  for (const dir of opts.paths) {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch { continue } // dir doesn't exist yet — fine

    for (const name of entries) {
      result.scanned++
      if (preserveLocks && name.endsWith(".lock")) continue
      const full = join(dir, name)
      try {
        const st = await fs.stat(full)
        if (st.isDirectory()) continue
        if (st.mtimeMs >= cutoff) continue
        if (!opts.dryRun) await fs.unlink(full)
        result.deleted++
        result.bytesFreed += st.size
      } catch {
        result.errors++
      }
    }
  }
  return result
}

/**
 * Returns free space ratio (0..1) on the filesystem holding `path`.
 * Uses `df -P` because Node has no built-in disk-stat API.
 */
export function getDiskFreePct(path: string): number {
  const r = spawnSync("df", ["-P", path], { encoding: "utf8" })
  if (r.status !== 0) return 1.0   // can't tell — assume fine, don't block cron
  const lines = r.stdout.trim().split("\n")
  if (lines.length < 2) return 1.0
  const parts = lines[1].split(/\s+/)
  // Filesystem 1024-blocks Used Available Capacity Mounted-on
  const total = Number.parseInt(parts[1], 10)
  const avail = Number.parseInt(parts[3], 10)
  if (!total || !avail) return 1.0
  return avail / total
}
