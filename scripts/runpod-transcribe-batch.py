"""
Batch transcriber for RunPod RTX 3090 + faster-whisper large-v3.

For STEREO recordings (Sipuni 2-channel) does role-perfect channel split:
  LEFT(ch0)  = MANAGER  (the CRM-side participant)
  RIGHT(ch1) = CLIENT   (the remote participant)

For MONO recordings falls back to single-pass transcription with no role labels.

Input:  JSONL stream on stdin or file ({id, url, dur, tenant} per line)
Output: JSONL on stdout/file ({id, transcript, language, prob, duration, took_s, mode})

Usage on RunPod:
  python3 transcribe_batch.py < batch.jsonl > results.jsonl
  # or
  python3 transcribe_batch.py batch.jsonl results.jsonl
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

# Allow expired SSL (Gravitel cert is broken, but most providers OK)
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
    """Return number of audio channels (1=mono, 2=stereo) or 0 on error."""
    try:
        r = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=channels",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return int(r.stdout.strip() or "0")
    except (subprocess.SubprocessError, ValueError):
        return 0


def split_channels(src: Path, left: Path, right: Path) -> bool:
    try:
        r = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(src),
                "-map_channel",
                "0.0.0",
                str(left),
                "-map_channel",
                "0.0.1",
                str(right),
            ],
            capture_output=True,
            timeout=60,
        )
        return r.returncode == 0 and left.exists() and right.exists()
    except subprocess.SubprocessError:
        return False


def transcribe_one(model: WhisperModel, fp: Path) -> tuple[list, float, str, float]:
    """Return (segments, duration, language, prob)."""
    segments, info = model.transcribe(
        str(fp), language=LANGUAGE, vad_filter=True, beam_size=5
    )
    return list(segments), info.duration, info.language, info.language_probability


def merge_by_timestamp(
    left_segs: list, right_segs: list, label_left: str, label_right: str
) -> str:
    """Merge two channel transcripts into one chronologically-ordered labeled text."""
    items = []
    for s in left_segs:
        items.append((s.start, label_left, s.text.strip()))
    for s in right_segs:
        items.append((s.start, label_right, s.text.strip()))
    items.sort(key=lambda x: x[0])
    lines = []
    last_label = None
    for start, label, text in items:
        if not text:
            continue
        mm = int(start // 60)
        ss = int(start % 60)
        if label != last_label:
            lines.append(f"\n[{label} {mm:02d}:{ss:02d}] {text}")
            last_label = label
        else:
            lines[-1] += " " + text
    return "\n".join(lines).strip()


def process_one(
    model: WhisperModel, row: dict
) -> dict:
    cid = row["id"]
    url = row["url"]
    src = WORK_DIR / f"{cid}.bin"
    left = WORK_DIR / f"{cid}.L.wav"
    right = WORK_DIR / f"{cid}.R.wav"

    t0 = time.time()
    if not download(url, src):
        return {"id": cid, "error": "download_failed", "url": url}

    channels = probe_channels(src)

    try:
        if channels == 2 and split_channels(src, left, right):
            ls, ld, lang, prob = transcribe_one(model, left)
            rs, _, _, _ = transcribe_one(model, right)
            text = merge_by_timestamp(ls, rs, "МЕНЕДЖЕР", "КЛИЕНТ")
            mode = "stereo_split"
            duration = ld
        else:
            segs, duration, lang, prob = transcribe_one(model, src)
            text = " ".join(s.text for s in segs).strip()
            mode = "mono_flat"
        took = time.time() - t0
        return {
            "id": cid,
            "transcript": text,
            "language": lang,
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
            try:
                p.unlink()
            except OSError:
                pass


def main() -> None:
    in_path = sys.argv[1] if len(sys.argv) > 1 else None
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    if in_path:
        in_lines = Path(in_path).read_text().splitlines()
    else:
        in_lines = sys.stdin.read().splitlines()
    rows = [json.loads(line) for line in in_lines if line.strip()]
    print(f"[init] {len(rows)} jobs queued", file=sys.stderr)

    t_load = time.time()
    model = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE_TYPE)
    print(f"[init] {MODEL_NAME} loaded in {time.time()-t_load:.1f}s", file=sys.stderr)

    out = open(out_path, "w") if out_path else sys.stdout
    ok, fail = 0, 0
    started_at = time.time()

    for i, row in enumerate(rows, 1):
        result = process_one(model, row)
        if "error" in result:
            fail += 1
        else:
            ok += 1
        json.dump(result, out, ensure_ascii=False)
        out.write("\n")
        out.flush()
        elapsed = time.time() - started_at
        avg = elapsed / i
        eta_min = avg * (len(rows) - i) / 60
        if "error" in result:
            print(
                f"[{i}/{len(rows)}] ERROR {result['id']}: {result['error']}",
                file=sys.stderr,
            )
        else:
            print(
                f"[{i}/{len(rows)}] ok={ok} fail={fail} "
                f"mode={result['mode']} dur={result['duration']:.0f}s "
                f"took={result['took_s']:.1f}s "
                f"speedup={result['duration']/result['took_s']:.1f}x ETA={eta_min:.1f}min",
                file=sys.stderr,
            )

    if out_path:
        out.close()
    print(
        f"[done] ok={ok} fail={fail} elapsed={(time.time()-started_at)/60:.1f}min",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
