"""
Pipeline v2 for production transcription on Intelion Cloud RTX 3090.

KEY FIXES vs v1 (runpod-transcribe-batch.py):
1. word_timestamps=True       — пословные таймстемпы (vs segment-level)
2. vad_filter=False           — не теряем тихие слова (no VAD over-cut)
3. condition_on_previous_text=False — не галлюцинирует из контекста
4. Per-channel transcribe     — L=manager, R=client отдельно
5. Word-level merge           — group consecutive same-channel words by gap < 0.6s
6. Save raw segments JSON     — страховка от изменений формата (TODO: add to apply-transcripts)

Input:  JSONL on stdin/file ({id, url, dur, tenant} per line)
Output: JSONL stdout/file ({id, transcript, raw_segments, language, prob, duration, took_s, mode})

Usage on Intelion:
  python3 intelion-transcribe-v2.py < batch.jsonl > results.jsonl
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import ssl
from pathlib import Path

from faster_whisper import WhisperModel

WORK_DIR = Path("/workspace/audio")
WORK_DIR.mkdir(parents=True, exist_ok=True)
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3")
LANGUAGE = os.environ.get("WHISPER_LANG", "ru")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "float16")

# Word grouping threshold — words from same speaker within this gap = same utterance
GAP_THRESHOLD = float(os.environ.get("GAP_THRESHOLD", "0.6"))

# Allow expired SSL (some providers have broken certs)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def download(url: str, dest: Path, timeout: int = 60) -> bool:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
            },
        )
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
            dest.write_bytes(r.read())
        return dest.stat().st_size > 1000
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        print(f"[download-fail] {url[:80]}: {e}", file=sys.stderr)
        return False


def probe_channels(path: Path) -> int:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=channels",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=15,
        )
        return int(r.stdout.strip() or "0")
    except (subprocess.SubprocessError, ValueError):
        return 0


def probe_duration(path: Path) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=15,
        )
        return float(r.stdout.strip() or "0")
    except (subprocess.SubprocessError, ValueError):
        return 0.0


def split_channels(src: Path, left: Path, right: Path) -> bool:
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
             "-map_channel", "0.0.0", str(left),
             "-map_channel", "0.0.1", str(right)],
            capture_output=True, timeout=60,
        )
        return r.returncode == 0 and left.exists() and right.exists()
    except subprocess.SubprocessError:
        return False


def transcribe_one_channel(model: WhisperModel, fp: Path):
    """Returns (segments_with_words, info).

    KEY: word_timestamps=True, vad_filter=False, condition_on_previous_text=False.
    """
    segments_iter, info = model.transcribe(
        str(fp),
        language=LANGUAGE,
        word_timestamps=True,           # ← пословные таймстемпы
        vad_filter=False,                # ← НЕ режем тихую речь
        condition_on_previous_text=False,  # ← без галлюцинаций
        beam_size=5,
        temperature=[0.0, 0.2, 0.4],     # температура fallback (стандарт OpenAI)
    )
    return list(segments_iter), info


def extract_words(segments, label: str):
    """Flatten segments → list of (start, end, label, word_text) tuples."""
    words = []
    for seg in segments:
        if not seg.words:
            # Fallback: если по какой-то причине без word_timestamps — берём весь сегмент
            words.append((seg.start, seg.end, label, seg.text.strip()))
            continue
        for w in seg.words:
            text = (w.word or "").strip()
            if not text:
                continue
            words.append((w.start, w.end, label, text))
    return words


def merge_words_into_utterances(words, gap_threshold: float = GAP_THRESHOLD):
    """Group consecutive same-channel words into utterances.

    New utterance when:
      - speaker changes, OR
      - gap between word.end of previous and word.start of current > gap_threshold
    """
    words.sort(key=lambda w: w[0])  # sort by start time
    utterances = []  # [(start_time, label, "concatenated text")]
    for w_start, w_end, label, text in words:
        if utterances:
            last_start, last_label, last_text = utterances[-1]
            last_end_estimate = utterances_end[-1] if utterances_end else last_start
            gap = w_start - last_end_estimate
            if last_label == label and gap <= gap_threshold:
                # Append to current utterance
                utterances[-1] = (last_start, last_label, last_text + " " + text)
                utterances_end[-1] = w_end
                continue
        # New utterance
        utterances.append((w_start, label, text))
        utterances_end.append(w_end)
    return utterances


# Module-level mutable state for end-times (used by merge func above)
utterances_end = []


def format_transcript(utterances) -> str:
    """Pretty format with [LABEL MM:SS] timestamps."""
    lines = []
    for start, label, text in utterances:
        mm = int(start // 60)
        ss = int(start % 60)
        lines.append(f"[{label} {mm:02d}:{ss:02d}] {text.strip()}")
    return "\n".join(lines)


def serialize_raw_segments(segments, label: str):
    """Compact JSON-friendly representation of raw segments.

    Saved to CallRecord.transcriptRaw — страховка от формата merge-логики.
    """
    out = []
    for seg in segments:
        out.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "label": label,
            "text": seg.text.strip(),
            "words": [
                {"s": round(w.start, 3), "e": round(w.end, 3), "t": (w.word or "").strip()}
                for w in (seg.words or [])
            ] if seg.words else None,
        })
    return out


def process_one(model: WhisperModel, row: dict) -> dict:
    cid = row["id"]
    url = row["url"]
    src = WORK_DIR / f"{cid}.bin"
    left = WORK_DIR / f"{cid}.L.wav"
    right = WORK_DIR / f"{cid}.R.wav"

    t0 = time.time()
    if not download(url, src):
        return {"id": cid, "error": "download_failed", "url": url}

    min_dur = float(os.environ.get("MIN_DURATION", "60"))   # default 60 сек (ниже = служебное)
    max_dur = float(os.environ.get("MAX_DURATION", "3600"))  # default 1 час
    actual_dur = probe_duration(src)
    if actual_dur < min_dur or actual_dur > max_dur:
        try: src.unlink()
        except OSError: pass
        return {
            "id": cid, "skipped": "duration_out_of_range",
            "actual_duration": round(actual_dur, 1),
        }

    channels = probe_channels(src)

    # Reset module-level state per-call
    global utterances_end
    utterances_end = []

    try:
        if channels == 2 and split_channels(src, left, right):
            # ── STEREO PATH (100% role accuracy) ──
            # Convention (verified on Sipuni/onPBX 2026-04-19+22):
            #   LEFT(ch0)  = remote = КЛИЕНТ
            #   RIGHT(ch1) = local  = МЕНЕДЖЕР
            ls, l_info = transcribe_one_channel(model, left)
            rs, _ = transcribe_one_channel(model, right)

            words = extract_words(ls, "КЛИЕНТ") + extract_words(rs, "МЕНЕДЖЕР")
            utterances = merge_words_into_utterances(words)

            text = format_transcript(utterances)
            raw = {
                "left_segments": serialize_raw_segments(ls, "КЛИЕНТ"),
                "right_segments": serialize_raw_segments(rs, "МЕНЕДЖЕР"),
                "merged_utterances": [
                    {"start": round(s, 3), "label": l, "text": t}
                    for s, l, t in utterances
                ],
            }
            mode = "stereo_word_merge_v2"
            duration = l_info.duration
            language = l_info.language
            prob = l_info.language_probability
        else:
            # ── MONO PATH (no role accuracy) ──
            segments, info = transcribe_one_channel(model, src)
            text = " ".join(s.text.strip() for s in segments)
            raw = {"mono_segments": serialize_raw_segments(segments, "")}
            mode = "mono_no_roles_v2"
            duration = info.duration
            language = info.language
            prob = info.language_probability

        took = time.time() - t0
        return {
            "id": cid,
            "transcript": text,
            "transcript_raw": raw,
            "language": language,
            "prob": round(prob, 3),
            "duration": round(duration, 1),
            "took_s": round(took, 1),
            "mode": mode,
            "channels": channels,
        }
    except Exception as e:
        return {"id": cid, "error": str(e)[:200]}
    finally:
        for p in (src, left, right):
            try: p.unlink()
            except OSError: pass


def main() -> None:
    in_path = sys.argv[1] if len(sys.argv) > 1 else None
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    if in_path:
        in_lines = Path(in_path).read_text().splitlines()
    else:
        in_lines = sys.stdin.read().splitlines()
    rows = [json.loads(line) for line in in_lines if line.strip()]
    print(f"[init] {len(rows)} jobs queued, model={MODEL_NAME} compute={COMPUTE_TYPE}", file=sys.stderr)

    t_load = time.time()
    model = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE_TYPE)
    print(f"[init] {MODEL_NAME} loaded in {time.time()-t_load:.1f}s", file=sys.stderr)

    out = open(out_path, "w") if out_path else sys.stdout
    ok, fail, skip = 0, 0, 0
    started_at = time.time()

    for i, row in enumerate(rows, 1):
        result = process_one(model, row)
        if "error" in result:
            fail += 1
        elif "skipped" in result:
            skip += 1
        else:
            ok += 1
        json.dump(result, out, ensure_ascii=False)
        out.write("\n")
        out.flush()
        elapsed = time.time() - started_at
        avg = elapsed / i
        eta_min = avg * (len(rows) - i) / 60
        if "error" in result:
            print(f"[{i}/{len(rows)}] ERROR {result['id']}: {result['error']}", file=sys.stderr)
        elif "skipped" in result:
            print(
                f"[{i}/{len(rows)}] SKIP {result['id']}: {result['skipped']} "
                f"(dur={result.get('actual_duration', 0)}s) ETA={eta_min:.1f}min",
                file=sys.stderr,
            )
        else:
            print(
                f"[{i}/{len(rows)}] ok={ok} fail={fail} skip={skip} "
                f"mode={result['mode']} dur={result['duration']:.0f}s "
                f"took={result['took_s']:.1f}s "
                f"speedup={result['duration']/max(result['took_s'],0.1):.1f}x ETA={eta_min:.1f}min",
                file=sys.stderr,
            )

    if out_path:
        out.close()
    print(
        f"[done] ok={ok} fail={fail} skip={skip} elapsed={(time.time()-started_at)/60:.1f}min",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
