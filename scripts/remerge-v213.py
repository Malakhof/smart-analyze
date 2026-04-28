"""v2.13 — split host monolog at REAL host boundaries, not at guest interrupt point.

Logic:
1. Build per-channel utterances with words preserved
2. Detect boundaries inside each host utterance (host's own pauses ≥1.0s, OR ≥0.5s + sentence-end punct)
3. For each significant guest utterance falling inside host time window:
   - Find nearest host boundary that is ≤ guest.start (i.e. host paused BEFORE guest spoke)
   - If such boundary exists within ±10s of guest.start → split host there, insert guest
   - If no boundary exists (host genuinely speaks through) → keep host whole, guest stays in monolog at its timestamp (rare cross-talk case)
4. Sort by start, format as before
"""
import json, re, os
from pathlib import Path

GAP_THRESHOLD = 3.0
MAX_WORD_SPAN_S = 3.0
LATE_START_S = 25.0

# v2.13 boundary detection
HOST_PAUSE_MIN = 1.0       # absolute pause threshold (any pause >=1s = boundary)
HOST_PUNCT_GAP_MIN = 0.05  # tiny gap after .!? = sentence end = boundary
SIGNIFICANT_WORDS = 2          # ≥2 words = meaningful answer ("Ну потихонечку", "Да хорошо")
SIGNIFICANT_DUR = 0.4          # OR speech ≥0.4s = real reply (single name "Наталья")
                               # backchannel-only ("угу/ага/да") dropped separately
BOUNDARY_SEARCH_WINDOW = 30.0  # max distance guest.start ↔ chosen boundary
                               # (длинные монологи: первая граница может быть через 15-20с от старта)

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

def merge_v213(mgr_words, cli_words):
    def build(words):
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
        text = ' '.join(w[2] for w in utt['words'])
        cleaned = re.sub(r'[.,!?]+', ' ', text.strip()).split()
        if cleaned and all(BACKCHANNEL_RE.match(w) for w in cleaned):
            return False
        return word_count >= SIGNIFICANT_WORDS or dur >= SIGNIFICANT_DUR

    def find_host_boundaries(host_utt):
        """Return list of word-indices AFTER which host has natural boundary.
        Index i means: split AFTER words[i] (so words[0..i] in chunk1, words[i+1..] in chunk2).
        Boundary criteria:
          - gap >= HOST_PAUSE_MIN, OR
          - gap >= HOST_PUNCT_GAP_MIN AND word ends with .!?
        """
        words = host_utt['words']
        boundaries = []  # list of (boundary_time, word_idx_after_which_to_split)
        for i in range(len(words) - 1):
            cur_end = words[i][1]
            next_start = words[i+1][0]
            gap = next_start - cur_end
            ends_punct = words[i][2].rstrip().endswith(('.', '!', '?'))
            if gap >= HOST_PAUSE_MIN:
                boundaries.append((next_start, i))
            elif gap >= HOST_PUNCT_GAP_MIN and ends_punct:
                boundaries.append((next_start, i))
        return boundaries

    def split_host_at_chosen_boundaries(host_utt, chosen_word_indices):
        """Split host_utt's words after each chosen index. Returns list of new utterances."""
        if not chosen_word_indices:
            return [host_utt]
        chunks = []
        words = host_utt['words']
        prev_end_idx = -1
        for split_idx in sorted(chosen_word_indices):
            chunk_words = words[prev_end_idx+1:split_idx+1]
            if chunk_words:
                chunks.append({
                    'start': chunk_words[0][0],
                    'end': chunk_words[-1][1],
                    'lbl': host_utt['lbl'],
                    'words': chunk_words
                })
            prev_end_idx = split_idx
        # Tail
        tail_words = words[prev_end_idx+1:]
        if tail_words:
            chunks.append({
                'start': tail_words[0][0],
                'end': tail_words[-1][1],
                'lbl': host_utt['lbl'],
                'words': tail_words
            })
        return chunks

    def split_host_for_guests(host_utts, guest_utts):
        """For each host utt, find significant guests inside its window and choose the best
        host boundary (≤ guest.start, within ±BOUNDARY_SEARCH_WINDOW) to insert guest after.
        Returns split host utterances list (guest is separate, will be sorted later)."""
        result = []
        for h in host_utts:
            interrupting_guests = [
                g for g in guest_utts
                if h['start'] < g['start'] < h['end']
                and is_significant(g)
            ]
            if not interrupting_guests:
                result.append(h)
                continue

            boundaries = find_host_boundaries(h)
            if not boundaries:
                # No boundaries — host is one continuous flow. Keep whole.
                # Guest will appear at its own timestamp, but visually after host
                # (since host.start < guest.start < host.end and we sort by start).
                # This is genuine cross-talk. Accept as-is.
                result.append(h)
                continue

            # For each guest, prefer boundary AT-OR-AFTER guest.start (so chunk2 starts after
            # guest, ensuring sort-by-start places guest between chunk1 and chunk2).
            # Falls back to boundary BEFORE guest if no after-boundary in window.
            chosen_indices = set()
            for g in interrupting_guests:
                gs = g['start']
                # Strict: boundary must be AFTER guest.start (so chunk2 starts after guest,
                # ensuring sort-by-start places chunk1 → guest → chunk2 in right order).
                after_candidates = [(t, idx) for t, idx in boundaries
                                    if t > gs and abs(t - gs) <= BOUNDARY_SEARCH_WINDOW]
                if after_candidates:
                    best = min(after_candidates, key=lambda x: abs(x[0] - gs))
                else:
                    before_candidates = [(t, idx) for t, idx in boundaries
                                         if abs(t - gs) <= BOUNDARY_SEARCH_WINDOW]
                    if not before_candidates:
                        continue
                    best = min(before_candidates, key=lambda x: abs(x[0] - gs))
                chosen_indices.add(best[1])

            if not chosen_indices:
                result.append(h)
                continue

            split_chunks = split_host_at_chosen_boundaries(h, chosen_indices)
            result.extend(split_chunks)
        return result

    mgr_split = split_host_for_guests(mgr, cli)
    cli_split = split_host_for_guests(cli, mgr)

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

    # v2.11 SMART DROP orphan reactions
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

# MAIN — process 10 problem files first for evaluation
PROBLEM_IDS = [
    "0e3bd264-bc5d-4de0-b9ff-4bc71851f7aa",
    "25d5f873-72f6-448d-9a66-20c4028ef189",
    "05c4a3cf-521e-439a-a036-a4d02e846036",
    "8292334b-d886-4ab5-9ba3-cca7b01dc4f7",
    "902d3028-58dd-4613-86b8-4ad2b41d9cc7",
    "3f1dae51-b6dd-40af-8c5c-afef3bfec031",
    "d0ba8a25-59fa-4c8a-8e5b-22e2cce336e8",
    "49697342-8df0-4da8-9945-5bd4443e7c0c",
    "b8367ce9-0fd2-475a-9ad8-65968c7dd7a9",
    "20b87fcd-f97b-4583-8ecf-7b6db8058eef",
]

# Load v2.12 transcripts (current production) for BEFORE
v212 = {}
for ln in open('/tmp/backfill-839/all-transcripts-v212.jsonl'):
    o = json.loads(ln)
    if o['id'] in PROBLEM_IDS:
        v212[o['id']] = o.get('transcript', '')

samples_dir = Path(os.path.expanduser('~/Desktop/v213-fix-samples'))
samples_dir.mkdir(exist_ok=True)

print(f"[init] v2.13 на {len(PROBLEM_IDS)} проблемных файлах")

for ln in open('/tmp/backfill-839/all-transcripts.jsonl'):
    o = json.loads(ln)
    uid = o['id']
    if uid not in PROBLEM_IDS: continue
    raw = o.get('transcript_raw') or {}
    ls = raw.get('left_segments') or []
    rs = raw.get('right_segments') or []
    if not ls and not rs:
        print(f"  {uid[:8]}: NO RAW")
        continue
    mgr_w = extract_words(ls, "МЕНЕДЖЕР")
    cli_w = extract_words(rs, "КЛИЕНТ")
    mgr_w = filter_repetition_loops(mgr_w)
    cli_w = filter_repetition_loops(cli_w)
    utts = merge_v213(mgr_w, cli_w)
    final = filter_halluc(utts)
    new_text = format(final)
    old_text = v212.get(uid, '')

    with open(samples_dir / f"{uid[:8]}_diff.txt", 'w') as f:
        f.write(f"=== {uid} ===\n\n")
        f.write("--- v2.12 (BEFORE) ---\n")
        f.write(old_text)
        f.write("\n\n--- v2.13 (split-on-host-boundary) ---\n")
        f.write(new_text)
        f.write(f"\n\n--- STATS ---\n")
        f.write(f"v2.12 lines: {len(old_text.split(chr(10)))}, v2.13 lines: {len(new_text.split(chr(10)))}\n")
        f.write(f"v2.12 chars: {len(old_text)}, v2.13 chars: {len(new_text)}\n")
    print(f"  {uid[:8]}: ok ({len(new_text)} chars)")

print(f"\n[done] {samples_dir}")
