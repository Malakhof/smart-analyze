"""v2.13 — apply to ALL 857. Generates JSONL + UPDATE SQL (without 'mode=' since that column doesn't exist)."""
import json, re
from pathlib import Path

# Reuse all logic from remerge-v213.py
exec(open('/tmp/backfill-839/remerge-v213.py').read().split('# MAIN — process 10 problem files first')[0])

print("[init] applying v2.13 to ALL 857 transcripts")
out_jsonl = open('/tmp/backfill-839/all-transcripts-v213.jsonl', 'w')
v212 = {}
for ln in open('/tmp/backfill-839/all-transcripts-v212.jsonl'):
    o = json.loads(ln)
    v212[o['id']] = o.get('transcript', '')

n_total = 0; n_changed = 0; n_skip_no_raw = 0
v213_results = {}
for ln in open('/tmp/backfill-839/all-transcripts.jsonl'):
    n_total += 1
    o = json.loads(ln)
    raw = o.get('transcript_raw') or {}
    ls = raw.get('left_segments') or []
    rs = raw.get('right_segments') or []
    if not ls and not rs:
        n_skip_no_raw += 1
        out_jsonl.write(ln); continue
    mgr_w = extract_words(ls, "МЕНЕДЖЕР")
    cli_w = extract_words(rs, "КЛИЕНТ")
    mgr_w = filter_repetition_loops(mgr_w)
    cli_w = filter_repetition_loops(cli_w)
    utts = merge_v213(mgr_w, cli_w)
    final = filter_halluc(utts)
    new_text = format(final)
    old_text = v212.get(o['id'], '')
    if new_text != old_text:
        n_changed += 1
        v213_results[o['id']] = new_text
    o['transcript'] = new_text
    o['mode'] = 'stereo_channel_first_v213'
    out_jsonl.write(json.dumps(o, ensure_ascii=False) + '\n')

out_jsonl.close()
print(f"[done] processed {n_total}, changed vs v2.12: {n_changed}, skipped (no raw): {n_skip_no_raw}")

# SQL без mode=
with open('/tmp/backfill-839/transcript-updates-v213.sql', 'w') as f:
    f.write("BEGIN;\n")
    n = 0
    for uid, txt in v213_results.items():
        safe = txt.replace("'", "''")
        f.write(f"UPDATE \"CallRecord\" SET transcript='{safe}' WHERE \"pbxUuid\"='{uid}';\n")
        n += 1
        if n % 100 == 0: f.write("COMMIT;\nBEGIN;\n")
    f.write("COMMIT;\n")
print(f"[sql] /tmp/backfill-839/transcript-updates-v213.sql ({n_changed} updates)")
