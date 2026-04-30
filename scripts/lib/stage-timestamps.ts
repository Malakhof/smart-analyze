/**
 * stage-timestamps.ts — append ISO-timestamped events to a per-tenant
 * timeline log AND a structured JSON record for later cron-metrics
 * (basis for canon-daily-health-check thresholds).
 *
 * Two outputs:
 *   /tmp/backfill-{tenant}-{window}-timeline.log    — human readable
 *   /tmp/backfill-{tenant}-{window}-events.jsonl    — machine readable
 */
import { promises as fs } from "node:fs"

export interface StageEvent {
  ts: string                     // ISO 8601 UTC
  cycleId: string                // unique per orchestrator run
  tenantId: string
  stage: string                  // 'stage-1', 'stage-7.5b', 'whisper', etc
  status: "start" | "done" | "skip" | "error"
  durationMs?: number            // wall-clock time, set on 'done'
  count?: number                 // rows / files processed
  meta?: Record<string, unknown>
}

export class StageLogger {
  private starts = new Map<string, number>()

  constructor(
    private readonly logPath: string,
    private readonly jsonlPath: string,
    private readonly cycleId: string,
    private readonly tenantId: string,
  ) {}

  async start(stage: string, meta: Record<string, unknown> = {}): Promise<void> {
    const now = Date.now()
    this.starts.set(stage, now)
    const ev: StageEvent = {
      ts: new Date(now).toISOString(),
      cycleId: this.cycleId, tenantId: this.tenantId,
      stage, status: "start", meta,
    }
    await this.write(ev, `[${stage}] start`)
  }

  async done(stage: string, count?: number, meta: Record<string, unknown> = {}): Promise<number> {
    const startedAt = this.starts.get(stage) ?? Date.now()
    const durationMs = Date.now() - startedAt
    const ev: StageEvent = {
      ts: new Date().toISOString(),
      cycleId: this.cycleId, tenantId: this.tenantId,
      stage, status: "done", durationMs, count, meta,
    }
    await this.write(ev, `[${stage}] done in ${(durationMs/1000).toFixed(1)}s${count != null ? ` (n=${count})` : ""}`)
    return durationMs
  }

  async skip(stage: string, reason: string): Promise<void> {
    const ev: StageEvent = {
      ts: new Date().toISOString(),
      cycleId: this.cycleId, tenantId: this.tenantId,
      stage, status: "skip", meta: { reason },
    }
    await this.write(ev, `[${stage}] skip: ${reason}`)
  }

  async error(stage: string, err: Error): Promise<void> {
    const startedAt = this.starts.get(stage) ?? Date.now()
    const ev: StageEvent = {
      ts: new Date().toISOString(),
      cycleId: this.cycleId, tenantId: this.tenantId,
      stage, status: "error",
      durationMs: Date.now() - startedAt,
      meta: { error: err.message },
    }
    await this.write(ev, `[${stage}] error: ${err.message}`)
  }

  private async write(ev: StageEvent, humanLine: string): Promise<void> {
    const stamp = ev.ts
    await fs.appendFile(this.logPath, `${stamp} ${humanLine}\n`)
    await fs.appendFile(this.jsonlPath, `${JSON.stringify(ev)}\n`)
  }
}
