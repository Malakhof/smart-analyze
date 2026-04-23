"""
Pipeline orchestrator: re-merges existing transcripts with AI-detected channel roles.

INPUT:
  - results-30-v24.jsonl (or any pipeline output with `transcript_raw.left_segments`/`right_segments`)
  - roles-detected.jsonl (output of `tsx scripts/detect-channel-roles.ts` — {id, left_role, right_role})

OUTPUT:
  - results-corrected.jsonl with re-merged transcripts using AI role labels

USAGE:
  # Step 1: detect roles (if not done)
  tsx scripts/detect-channel-roles.ts --input /tmp/tuning/results-30-v24.jsonl > /tmp/tuning/roles.jsonl

  # Step 2: re-merge
  python3 scripts/orchestrate-pipeline.py \\
    --input /tmp/tuning/results-30-v24.jsonl \\
    --roles /tmp/tuning/roles.jsonl \\
    --output /tmp/tuning/results-corrected.jsonl

WHY: Whisper pipeline produces raw per-channel segments. Initial role labels (LEFT=МЕНЕДЖЕР default
or LEFT=КЛИЕНТ for Sipuni outbound) are correct for ~60% of calls. AI role detector reads first 30s
of each channel and assigns roles based on CONTENT (who introduces themselves, who says "Алло"),
which is ~99% accurate. This script applies AI roles to existing raw_segments and re-runs the
channel-first merge — no need for re-transcription.
"""
import argparse
import json
import sys
from pathlib import Path

GAP_THRESHOLD = 2.0


def merge_channel_first(mgr_words, cli_words, gap_threshold=GAP_THRESHOLD):
    """Same logic as intelion-transcribe-v2.py:merge_channel_first.

    Build per-channel utterances FIRST (drift-resistant), then interleave by start time.
    """
    def build(words):
        words = sorted(words, key=lambda w: w[0])
        utts = []  # (start, end, label, text)
        for w in words:
            ws, we, lbl, txt = w[0], w[1], w[2], w[3]
            if utts:
                ls, le, ll, lt = utts[-1]
                if (ws - le) <= gap_threshold:
                    utts[-1] = (ls, we, lbl, lt + " " + txt)
                    continue
            utts.append((ws, we, lbl, txt))
        return utts

    all_utts = build(mgr_words) + build(cli_words)
    all_utts.sort(key=lambda u: u[0])
    return [(s, lbl, txt) for s, e, lbl, txt in all_utts]


HALLUCINATION_PATTERNS = [
    r"DimaTorzok", r"redactor.*субтитр", r"редактор.*субтитр",
    r"субтитр[ыов]?\s*создавал", r"субтитр[ыов]?\s*от", r"субтитры?\s*by",
    r"корректор\s*субтитр", r"перевод\s*и?\s*субтитры",
    r"спасибо\s*за\s*просмотр", r"thank.*for.*watching",
    r"продолжение\s*следует",
    r"^\s*звонок\s*телефона\s*$",
    r"^\s*звонок\s+(дверь|телефон)\s*$",
]
import re as _re
_HALLUCINATION_RE = _re.compile("|".join(HALLUCINATION_PATTERNS), _re.IGNORECASE)


def filter_hallucinations(utterances):
    return [(s, lbl, txt) for s, lbl, txt in utterances if not _HALLUCINATION_RE.search(txt)]


def format_transcript(utterances):
    lines = []
    for start, label, text in utterances:
        mm = int(start // 60)
        ss = int(start % 60)
        lines.append(f"[{label} {mm:02d}:{ss:02d}] {text.strip()}")
    return "\n".join(lines)


def extract_words(segments, label):
    """Convert raw segments into word tuples with assigned label."""
    words = []
    for seg in segments or []:
        for w in seg.get("words") or []:
            text = (w.get("t") or "").strip()
            if not text:
                continue
            s = w.get("s") or 0
            e = w.get("e") or s
            words.append((s, e, label, text))
    return words


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Pipeline results JSONL with transcript_raw")
    ap.add_argument("--roles", required=True, help="AI role detector output JSONL")
    ap.add_argument("--output", required=True, help="Corrected results JSONL output")
    args = ap.parse_args()

    # Load AI roles into id-keyed dict
    roles_by_id = {}
    with open(args.roles) as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            r = json.loads(ln)
            cid = r.get("id")
            left = r.get("left_role") or r.get("left")
            right = r.get("right_role") or r.get("right")
            if cid and left and right:
                roles_by_id[cid] = (left, right)
    print(f"[init] loaded {len(roles_by_id)} role mappings", file=sys.stderr)

    n_corrected = 0
    n_unchanged = 0
    n_skipped = 0
    n_total = 0

    with open(args.input) as fin, open(args.output, "w") as fout:
        for ln in fin:
            ln = ln.strip()
            if not ln:
                continue
            o = json.loads(ln)
            cid = o.get("id")
            n_total += 1

            # Pass through errors/skips unchanged
            if "error" in o or "skipped" in o:
                fout.write(json.dumps(o, ensure_ascii=False) + "\n")
                n_skipped += 1
                continue

            raw = o.get("transcript_raw") or {}
            if not raw.get("left_segments") and not raw.get("right_segments"):
                # No raw data — pass through
                fout.write(json.dumps(o, ensure_ascii=False) + "\n")
                n_skipped += 1
                continue

            # Get AI role mapping
            if cid not in roles_by_id:
                # No AI mapping — keep original
                fout.write(json.dumps(o, ensure_ascii=False) + "\n")
                n_unchanged += 1
                continue

            left_role, right_role = roles_by_id[cid]

            # Re-extract words with AI labels
            left_words = extract_words(raw["left_segments"], left_role)
            right_words = extract_words(raw["right_segments"], right_role)

            mgr_words = [w for w in (left_words + right_words) if w[2] == "МЕНЕДЖЕР"]
            cli_words = [w for w in (left_words + right_words) if w[2] == "КЛИЕНТ"]

            utterances = merge_channel_first(mgr_words, cli_words)
            utterances = filter_hallucinations(utterances)

            new_transcript = format_transcript(utterances)

            # Save corrected result
            o_corrected = dict(o)
            o_corrected["transcript_original"] = o.get("transcript")
            o_corrected["transcript"] = new_transcript
            o_corrected["mode"] = "stereo_channel_first_orchestrated"
            # Update raw role_mapping for traceability
            if "transcript_raw" in o_corrected:
                o_corrected["transcript_raw"]["role_mapping"] = {
                    "source": "ai_role_detector",
                    "left": left_role,
                    "right": right_role,
                }

            fout.write(json.dumps(o_corrected, ensure_ascii=False) + "\n")
            n_corrected += 1

            # Was it actually different? Compare label sets in first 5 lines
            old_first = (o.get("transcript") or "").split("\n")[:5]
            new_first = new_transcript.split("\n")[:5]
            old_labels = [l.split("]")[0].split("[")[-1].split()[0] for l in old_first if "[" in l]
            new_labels = [l.split("]")[0].split("[")[-1].split()[0] for l in new_first if "[" in l]
            swap_changed = old_labels != new_labels
            if swap_changed:
                print(f"  {cid}: roles SWAPPED ({old_labels[:3]} → {new_labels[:3]})", file=sys.stderr)

    print(f"\n[done] total={n_total} corrected={n_corrected} unchanged={n_unchanged} skipped={n_skipped}", file=sys.stderr)


if __name__ == "__main__":
    main()
