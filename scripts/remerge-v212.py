"""v2.12 re-merge — fixes orphan-tail bug.
v2.11: drop_orphan_reactions (≤4 words inside ≥20s monolog) — но это режет, не вставляет.
v2.12: split per-channel utterance на breakpoints значимых реплик opposite канала.
       реплики >=5 слов OR >=1.5с — breakpoint.
       МОП-блок 83-193 + КЛИЕНТ 102, 132, 138, 151, 166, 175, 177
       → МОП split на 8 кусков, после sort by start всё в правильной хронологии.

Reads /tmp/backfill-839/all-transcripts.jsonl
Outputs /tmp/backfill-839/all-transcripts-v212.jsonl + diff samples (30 files)
"""
import json, re, os, random
from pathlib import Path

GAP_THRESHOLD = 3.0
PROB_THRESHOLD = 0.20
MAX_WORD_SPAN_S = 3.0
LATE_START_S = 25.0

# v2.12 split params
SIGNIFICANT_WORDS = 5
SIGNIFICANT_DUR = 1.5

HALLUC_RE = re.compile("|".join([
    r"DimaTorzok", r"redactor.*субтитр", r"редактор.*субтитр",
    r"субтитр[ыов]?\s*создавал", r"субтитр[ыов]?\s*от", r"субтитры?\s*by",
    r"корректор\s*субтитр", r"перевод\s*и?\s*субтитры",
    r"спасибо\s*за\s*просмотр", r"thank.*for.*watching",
    r"продолжение\s*следует", r"^\s*продолжение\.{0,5}\s*$",
    r"^\s*звонок\s*телефона\s*$", r"^\s*звонок\s+(дверь|телефон)\s*$",
    r"телефонный\s+звонок",
    r"^\s*(в\s+)?(звонок|дверь)\.{0,5}\s*$",
    r"^\s*звонок\s+в\s+дверь\.{0,5}\s*$",
    r"^\s*время\.{0,5}\s*$",
    r"вызываемый\s+абонент\s+не\s+отвечает",
    r"оставайтесь\s+на\s+линии",
    r"после\s+(акустического|звукового)\s+сигнала",
]), re.IGNORECASE)
BACKCHANNEL_RE = re.compile(r"^(угу|ага|да|мм-?хмм|м-?м|так|ну\s*да)[\s.,!?]*$", re.IGNORECASE)

def extract_words(segs, label):
    words = []
    for seg in segs:
        if HALLUC_RE.search(seg.get('text','')): continue
        for w in (seg.get('words') or []):
            t = (w.get('t') or '').strip()
            if not t: continue
            if (w['e']-w['s']) > MAX_WORD_SPAN_S: continue
            words.append((w['s'], w['e'], label, t))
    return words

def filter_repetition_loops(words, max_repeats=5, window_s=10.0):
    if not words: return words
    keep = [True]*len(words)
    for i,(s_i,_,_,t_i) in enumerate(words):
        if not keep[i]: continue
        norm = t_i.lower().strip(".,!?;:—-")
        if len(norm) > 8: continue
        run = [i]
        for j in range(i+1, len(words)):
            if words[j][0]-s_i > window_s: break
            if words[j][3].lower().strip(".,!?;:—-") == norm: run.append(j)
        if len(run) > max_repeats:
            for idx in run[max_repeats:]: keep[idx] = False
    return [w for w,k in zip(words,keep) if k]

def merge_v212(mgr_words, cli_words):
    """v2.12 — build with words preserved, split host utts at significant guest interruptions."""
    def build(words):
        """Build utterances with WORDS preserved (needed for split)."""
        words = sorted(words, key=lambda w: w[0])
        utts = []
        for w in words:
            ws,we,lbl,txt = w
            if utts and (ws - utts[-1]['end']) <= GAP_THRESHOLD and utts[-1]['lbl'] == lbl:
                utts[-1]['end'] = we
                utts[-1]['words'].append((ws, we, txt))
            else:
                utts.append({'start': ws, 'end': we, 'lbl': lbl, 'words': [(ws, we, txt)]})
        return utts

    mgr = build(mgr_words)
    cli = build(cli_words)

    def is_significant(utt):
        word_count = len(utt['words'])
        dur = utt['end'] - utt['start']
        # Skip backchannel-only
        text = ' '.join(w[2] for w in utt['words'])
        cleaned = re.sub(r'[.,!?]+', ' ', text.strip()).split()
        if cleaned and all(BACKCHANNEL_RE.match(w) for w in cleaned):
            return False
        return word_count >= SIGNIFICANT_WORDS or dur >= SIGNIFICANT_DUR

    def split_at_interruptions(host_utts, guest_utts):
        """For each host utterance, split at start times of significant guest utts inside [host.start, host.end]."""
        result = []
        for h in host_utts:
            # Significant guests inside h's time window (strictly inside)
            interruptions = sorted([
                g['start'] for g in guest_utts
                if h['start'] < g['start'] < h['end']
                and is_significant(g)
            ])
            if not interruptions:
                result.append(h)
                continue
            # Split h's words at each interruption time
            split_points = interruptions + [float('inf')]
            cur_words = []
            cur_start = h['start']
            sp_idx = 0
            for w in h['words']:
                # Advance split index if word crosses next breakpoint
                while sp_idx < len(split_points)-1 and w[0] >= split_points[sp_idx]:
                    if cur_words:
                        result.append({'start': cur_start, 'end': cur_words[-1][1], 'lbl': h['lbl'], 'words': cur_words})
                    cur_words = []
                    cur_start = w[0]
                    sp_idx += 1
                cur_words.append(w)
            if cur_words:
                result.append({'start': cur_start, 'end': cur_words[-1][1], 'lbl': h['lbl'], 'words': cur_words})
        return result

    mgr_split = split_at_interruptions(mgr, cli)
    cli_split = split_at_interruptions(cli, mgr)

    # Convert to legacy tuples
    def to_tuple(u):
        text = ' '.join(w[2] for w in u['words'])
        return (u['start'], u['end'], u['lbl'], text)

    mgr_t = [to_tuple(u) for u in mgr_split]
    cli_t = [to_tuple(u) for u in cli_split]

    # Drop backchannel-only utterances
    def drop_bc(utts):
        out = []
        for u in utts:
            cleaned = re.sub(r'[.,!?]+', ' ', u[3].strip()).split()
            if cleaned and all(BACKCHANNEL_RE.match(w) for w in cleaned): continue
            out.append(u)
        return out
    mgr_t = drop_bc(mgr_t); cli_t = drop_bc(cli_t)

    # v2.11 SMART DROP orphan reactions (≤4 слов, <3с, внутри ≥20с монолога противоположного канала)
    def drop_orphan(host, guest):
        if not host or not guest: return guest
        long_spans = [(h[0], h[1]) for h in host if (h[1]-h[0]) >= 20.0]
        if not long_spans: return guest
        kept = []
        for g in guest:
            gs, ge, _, gtxt = g
            wc = len(gtxt.strip().split())
            if wc <= 4 and (ge-gs) < 3.0:
                if any(hs <= gs and ge <= he for hs,he in long_spans):
                    continue
            kept.append(g)
        return kept
    cli_t = drop_orphan(mgr_t, cli_t)
    mgr_t = drop_orphan(cli_t, mgr_t)

    all_utts = mgr_t + cli_t
    all_utts.sort(key=lambda u: u[0])
    return [(s, lbl, txt) for s,e,lbl,txt in all_utts]

def filter_halluc(utts):
    return [(s,l,t) for s,l,t in utts if not HALLUC_RE.search(t)]

def split_at_sentences(text, target=45):
    parts = re.split(r"(?<=[.!?])\s+", text)
    chunks = []; current = []; cw = 0
    for p in parts:
        wc = len(p.split())
        if current and cw+wc > target:
            chunks.append(" ".join(current)); current = [p]; cw = wc
        else:
            current.append(p); cw += wc
    if current: chunks.append(" ".join(current))
    return chunks

def format(utts):
    lines = []
    if utts and utts[0][0] > LATE_START_S:
        lines.append("[МЕНЕДЖЕР 00:00] (Приветствие. ПД. ФИО)")
    for s, l, t in utts:
        mm = int(s//60); ss = int(s%60)
        prefix = f"[{l} {mm:02d}:{ss:02d}] "
        text = t.strip(); wc = len(text.split())
        if wc <= 60: lines.append(prefix + text); continue
        chunks = split_at_sentences(text, 45)
        lines.append(prefix + chunks[0])
        for c in chunks[1:]: lines.append(c)
    return "\n".join(lines)

# MAIN — process all 857, write to v212 jsonl, but apply to DB only on confirm
print("[init] re-merging 857 with v2.12 logic (split-on-interrupt)...")
out_jsonl = open('/tmp/backfill-839/all-transcripts-v212.jsonl', 'w')
n_changed = 0; n_total = 0; n_skipped = 0
v212_results = {}

for ln in open('/tmp/backfill-839/all-transcripts-v211.jsonl'):
    n_total += 1
    o = json.loads(ln)
    raw = o.get('transcript_raw') or {}
    ls = raw.get('left_segments') or []
    rs = raw.get('right_segments') or []
    if not ls and not rs:
        out_jsonl.write(ln)
        n_skipped += 1
        continue
    mgr_w = extract_words(ls, "МЕНЕДЖЕР")
    cli_w = extract_words(rs, "КЛИЕНТ")
    mgr_w = filter_repetition_loops(mgr_w)
    cli_w = filter_repetition_loops(cli_w)
    utts = merge_v212(mgr_w, cli_w)
    final = filter_halluc(utts)
    new_text = format(final)
    old_text = o.get('transcript') or ''
    if new_text != old_text:
        n_changed += 1
        v212_results[o['id']] = (old_text, new_text)
    o['transcript'] = new_text
    o['mode'] = 'stereo_channel_first_v212'
    out_jsonl.write(json.dumps(o, ensure_ascii=False) + '\n')

out_jsonl.close()
print(f"[done] processed {n_total}, CHANGED vs v2.11 {n_changed}, skipped (no raw) {n_skipped}")

# Generate diff samples — first 30 changed (in order)
samples_dir = Path(os.path.expanduser('~/Desktop/v212-fix-samples'))
samples_dir.mkdir(exist_ok=True)
sample_ids = list(v212_results.keys())[:30]

for uid in sample_ids:
    old, new = v212_results[uid]
    with open(samples_dir / f'{uid[:8]}_diff.txt', 'w') as f:
        f.write(f"=== {uid} ===\n\n")
        f.write("--- v2.11 (BEFORE) ---\n")
        f.write(old)
        f.write("\n\n--- v2.12 (AFTER split-on-interrupt) ---\n")
        f.write(new)

print(f"[samples] {len(sample_ids)} diffs written to {samples_dir}")

# SQL для UPDATE — будет применён ТОЛЬКО после подтверждения user
with open('/tmp/backfill-839/transcript-updates-v212.sql', 'w') as f:
    f.write("BEGIN;\n")
    n = 0
    for uid, (old, new) in v212_results.items():
        safe = new.replace("'", "''")
        f.write(f"UPDATE \"CallRecord\" SET transcript='{safe}', mode='stereo_channel_first_v212' WHERE \"pbxUuid\"='{uid}';\n")
        n += 1
        if n % 100 == 0: f.write("COMMIT;\nBEGIN;\n")
    f.write("COMMIT;\n")
print(f"[sql] /tmp/backfill-839/transcript-updates-v212.sql ({n_changed} updates) — НЕ применён, ждёт verify")
