# 2026-05-03 — Pipeline watch findings (diva-school)

Watch period: 2026-05-02 21:00 UTC (after wrapper fix) → 2026-05-04 04:00 UTC (planned ping #2). During this window 4 distinct bugs surfaced. All 4 fixed today; 4 follow-up issues opened for reviewer.

## Resolved (today)

### Bug #1 — sh wrapper drops args (producer cron mute 6h45m)
- **Symptom**: producer log mtime frozen at 14:00 UTC 2.05; syslog shows cron firing every 15 min; 0 cycleId starts in 7h.
- **Root cause**: `sh -c 'set -a && . /app/.env && set +a && exec node_modules/.bin/tsx' scripts/cron-master-pipeline.ts diva-school --skip-gpu --skip-deepseek` — `sh -c 'cmd' arg1 arg2` makes args become `$0/$1` to the shell, never reaching `cmd`. tsx ran with no script → REPL mode → silent exit 0 → no output.
- **Detection**: cron syslog ✓ + producer log mtime stale + manual `sh -c '... exec tsx' arg1` reproduction returned exit 0 with no output.
- **Fix**: `sh -c '... exec tsx "$@"' -- script.ts arg1 arg2` (`--` placeholder for `$0`).
- **Commit**: `fix(cron): pass args through sh -c wrapper via "$@"`
- **Files**: `scripts/install-cron-pipeline.sh`
- **Proof**: 6 consecutive green cycleId post-fix at 21:00, 21:15, 21:30, 21:45, 22:00, 22:15 UTC 2.05.

### Bug #2 — claimPersistOnlyBatch starvation (230 broken transcribed rows)
- **Symptom**: worker only emitted `worker-persist-only` events for 22h+; 0 `worker-claim` events; 0 GpuRun since 2.05 11:31 UTC; pending=177 not draining.
- **Root cause**: 230 rows had `transcriptionStatus='transcribed' AND transcript IS NOT NULL` BUT empty `pbxUuid` (legacy from earlier broken cycles). `claimPersistOnlyBatch` SQL didn't filter on pbxUuid. Worker built fake results.jsonl with `id: r.pbxUuid = ''` → `persist-pipeline-results.ts:111 if (!uuid) skip` skipped all 30 → `applied=0` → stage `apply-transcripts` returned ok=false → status stayed `transcribed` → next iteration re-claimed same 30 rows. Infinite loop blocked claim section (`if (persistOnlyBatch.length > 0) continue`).
- **Detection**: events.jsonl tail showed only persist-only stage; SELECT on transcribed showed all 230 had empty pbxUuid; same `transcriptionAt` timestamp on 5 sample rows (constantly re-touched).
- **Fix**: SQL transaction — archive 230 to `_legacy_broken_transcribed` (CREATE TABLE LIKE CallRecord INCLUDING ALL with COMMENT carrying reason) + UPDATE status='failed'. Code unchanged.
- **No commit** — data fix only. Reason recorded in `_legacy_broken_transcribed` table COMMENT.

### Bug #3 — onPBX creds source mismatch (worker reading process.env, keys live in DB)
- **Symptom**: post-Bug-#2-fix, worker engaged claim path, GPU pod started, but every Whisper batch failed with `/app/scripts/run-full-pipeline.sh: line 108: ON_PBX_KEY_ID: ON_PBX_KEY_ID not set in caller env`. 48 rows wasted (claimed → failed) over 2 batches in 5 min.
- **Root cause**: `whisper-worker.ts:127-128` populated env vars from `process.env.ON_PBX_KEY_ID ?? ""`. .env on prod doesn't contain ON_PBX_KEY_ID (security cleanup commit 9f3d064 stripped legacy hardcoded secrets; the keys were always supposed to live in `Tenant.pbxConfig` per migration `manual-cron-pipeline.sql`). Worker had access via `tenant.adapter` (loadTenantWithPbx → loadOnPbxAuth decrypts from DB) but didn't use it.
- **Detection**: `grep ON_PBX_KEY_ID .env` → MISSING. Cross-checked: `grep -nE 'ON_PBX_KEY' worker.ts run-full-pipeline.sh` showed worker pulled from process.env, run-full-pipeline.sh hard-required from caller env.
- **Fix**: added `OnPbxAdapter.getCreds()` read-only snapshot method (auth stays private, snapshot is per-call so auto-refresh in-place mutations propagate to next batch). Worker reads `tenant.adapter.getCreds()` for ON_PBX_DOMAIN/KEY_ID/KEY.
- **Commit**: `fix(worker): pull onPBX creds from tenant.adapter, not process.env`
- **Files**: `scripts/whisper-worker.ts`, `src/lib/pbx/onpbx-adapter.ts`

### Bug #4 — 131 pending rows with NULL audioUrl (Stage 7.5b regression)
- **Symptom**: post-Bug-#3-fix, worker started but stayed idle: `pending=3 < min=10 — idle`, while DB showed pending=133.
- **Root cause #1**: `countPendingForTenant` filter `AND "audioUrl" IS NOT NULL` is intentional guard (worker design assumes Stage 7.5b filled GC URL). 130 of 133 pending had NULL audioUrl → only 3 visible to worker → below MIN_BATCH=10.
- **Root cause #2 (data)**: 2026-05-01 had 0/628 audioUrl coverage (full day anomaly). GC cookie age was 308h on 2.05 — likely expired around 1.05, breaking Stage 7.5b GC contact-list scrape for the entire day.
- **Verification**: curl smoke 3/3 sample uuids (fresh 3.05, mid 1.05 anomaly day, old 29.04) returned valid `https://api2.onlinepbx.ru/calls-records/download/...` URLs from `mongo_history/search.json` POST with download=1. onPBX retains records ~30+ days.
- **Fix**: one-shot `scripts/backfill-audiourl-from-pbx.ts --tenant=diva-school --apply` — resolves URL via onPBX API per pbxUuid, UPDATEs `audioUrl`. 131 candidates, 100% resolve rate, 23.5s elapsed. Worker filter REMAINS untouched (legitimate Stage 7.5b health guard).
- **Commit**: `feat(scripts): backfill audioUrl from onPBX API for legacy NULL rows`
- **Files**: `scripts/backfill-audiourl-from-pbx.ts` (new)
- **Proof end-to-end**: post-backfill worker engaged claim → pod up → Whisper done {ok:true} batch=30 within 8 min. 0 ON_PBX errors. pending 135 → 108, in_flight 8, transcribed 22.

## Open for reviewer 2026-05-04

1. **Stage 7.5b regression on 2026-05-01** — root cause for 308h cookie age. Cookie probe is hourly (`0 * * * *`) but didn't trigger refresh between cookie expiry and 2.05 14:44 UTC manual refresh. Audit `scripts/cron-gc-cookie-check.ts` schedule + `getcourse-session.ts` refresh logic. Likely auto-refresh wasn't registered in crontab on 1.05 (predates wrapper fix scope).
2. **`claimPersistOnlyBatch` filter** — add `AND "pbxUuid" IS NOT NULL AND "pbxUuid" != ''` to prevent recurrence of Bug #2 starvation. `scripts/lib/worker-claim.ts`.
3. **Silent-exit detector for cron tsx wrappers** — Bug #1 hid for 6h45m because cron CMD fired but produced no log. Add health-check assertion: `producer.log mtime` must be < 30 min OR alert. Today's `scripts/daily-health-check.ts` parses cycleId timestamps but doesn't cross-check against syslog cron firing count.
4. **`transcriptionError` column on CallRecord** — bug #2 archive's failed reason lives in `_legacy_broken_transcribed` table COMMENT. For grep'ability and future audit on the live table, migration `ALTER TABLE "CallRecord" ADD COLUMN "transcriptionError" TEXT`.
5. **Reconcile false-positive on canon-filter exclusions** —
   **Symptom**: Telegram alert "discrepancy 25.0%" at 12:00 UTC 3.05.2026, window 11:45-12:00. PBX=4 DB=3 missingInDb=0. Self-corrected next cycle (12:15: pbx=11 db=11 0%).
   **Root cause**: Stage 9 reconcile compares **raw PBX count** vs **post-canon-filter DB count**. Canon-#8 (Stage 1.5) drops rows by `user_talk_time` / `hangup_cause` / `managerExt NOT IN ('117','118','124')` — correct behavior, but reconcile doesn't account for it.
   **Impact**: Periodic false-positive alerts on small windows (1-4 PBX rows × filter exclusion) — 25-33% discrepancy with `missingInDb=0`. Self-correcting on larger windows.
   **Fix proposal**: change reconcile metric from `pbx_raw_count vs db_count` to `pbx_after_canon_filter vs db_count`. Alternative: raise threshold for small windows (skip alert if `|pbx-db| ≤ 1` and window < 15 min).
   **Files**: `scripts/cron-master-pipeline.ts` (Stage 9 reconcile section), `scripts/lib/canon-filter.ts` if separate module exists.
   **Priority**: Low (no data loss, only noise).

## Watch state going into ping #2

| Slice | Status |
|---|---|
| Producer clock | 2.05 21:00 UTC + 36h+ green |
| Worker clock | 3.05 10:36:41 UTC (1st successful Whisper batch post-fix) |
| Pending drain | 108 → expected 0 by 11:30 UTC (4-5 batches × 30 calls) |
| ping #2 expectation | `✅ diva-school: NN ticks, NN batches, GPU $X, balances` |

## File map for reviewer

- `scripts/install-cron-pipeline.sh` — Bug #1 fix
- `scripts/whisper-worker.ts` — Bug #3 fix (worker side)
- `src/lib/pbx/onpbx-adapter.ts` — Bug #3 fix (getter)
- `scripts/backfill-audiourl-from-pbx.ts` — Bug #4 fix (one-shot script)
- `scripts/lib/worker-claim.ts` — open issue #2 (no change today)
- `scripts/cron-gc-cookie-check.ts` + `src/lib/crm/getcourse-session.ts` — open issue #1
- `scripts/daily-health-check.ts` — open issue #3
- `_legacy_broken_transcribed` table — Bug #2 archive
