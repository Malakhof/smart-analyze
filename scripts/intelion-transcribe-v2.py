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
import wave
import audioop

WORK_DIR = Path("/workspace/audio")
WORK_DIR.mkdir(parents=True, exist_ok=True)
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3")
LANGUAGE = os.environ.get("WHISPER_LANG", "ru")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "float16")

# Word grouping threshold — words from same speaker within this gap = same utterance.
# Increased from 0.6s → 2.0s after first prod test: slow speakers (elderly clients)
# pause for 1-2s mid-phrase, and 0.6s threshold split их фразы in 5-10 фрагментов.
GAP_THRESHOLD = float(os.environ.get("GAP_THRESHOLD", "2.0"))

# Probability threshold for keeping a word. Cross-channel echo bleed produces
# words with prob ~0.3-0.5; real voice prob ~0.7-0.95. Drop low-prob words.
PROB_THRESHOLD = float(os.environ.get("PROB_THRESHOLD", "0.55"))

# Cross-channel dedup window: if same/similar word appears on both channels
# within this time window — drop the one with lower probability (it's bleed).
ECHO_WINDOW_S = float(os.environ.get("ECHO_WINDOW_S", "1.5"))

# Energy-based filter ratio. If during word time, the OTHER channel's RMS
# is N× louder than THIS channel's RMS — this word is echo. Default 2.5×
# (echo is typically -8 to -20 dB quieter, i.e. 2.5-10× ratio).
ECHO_ENERGY_RATIO = float(os.environ.get("ECHO_ENERGY_RATIO", "2.5"))

# Allow expired SSL (some providers have broken certs)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def resolve_onpbx_url(uuid: str) -> str:
    """Resolve fresh download URL from onPBX (URLs expire ~30 min).

    Requires env: ON_PBX_DOMAIN (e.g. 'pbx1720.onpbx.ru'), ON_PBX_KEY_ID, ON_PBX_KEY.
    """
    domain = os.environ.get("ON_PBX_DOMAIN")
    key_id = os.environ.get("ON_PBX_KEY_ID")
    key = os.environ.get("ON_PBX_KEY")
    if not (domain and key_id and key):
        return None
    body = urllib.parse.urlencode({"uuid": uuid, "download": "1"}).encode()
    req = urllib.request.Request(
        f"https://api.onlinepbx.ru/{domain}/mongo_history/search.json",
        data=body, method="POST",
        headers={"x-pbx-authentication": f"{key_id}:{key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            j = json.loads(r.read())
        url = j.get("data")
        if isinstance(url, str) and url.startswith("http"):
            return url
    except Exception as e:
        print(f"[onpbx-resolve-fail] uuid={uuid}: {e}", file=sys.stderr)
    return None


def download(url: str, dest: Path, timeout: int = 60, uuid: str = None) -> bool:
    """Download with retry. If URL fails (e.g. expired) AND uuid provided AND env has onPBX creds —
    re-resolve fresh URL via API and retry once."""
    def _try(u):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                dest.write_bytes(r.read())
            return dest.stat().st_size > 1000
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            print(f"[download-fail] {u[:80]}: {e}", file=sys.stderr)
            return False

    if _try(url):
        return True
    # Retry with fresh URL via onPBX resolve if available
    if uuid:
        fresh = resolve_onpbx_url(uuid)
        if fresh and fresh != url:
            print(f"[onpbx-retry] uuid={uuid} fresh URL", file=sys.stderr)
            return _try(fresh)
    return False


# Patch urllib.parse import for resolve_onpbx_url
import urllib.parse


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
    v2.4: repetition guards (no_repeat_ngram_size + repetition_penalty) — prevents
    Whisper looping into "вот, вот, вот ×80" on monotone segments (seen on long calls).
    """
    segments_iter, info = model.transcribe(
        str(fp),
        language=LANGUAGE,
        word_timestamps=True,           # ← пословные таймстемпы
        vad_filter=False,                # ← НЕ режем тихую речь
        condition_on_previous_text=False,  # ← без галлюцинаций
        beam_size=5,
        temperature=[0.0, 0.2, 0.4],     # температура fallback (стандарт OpenAI)
        no_repeat_ngram_size=3,          # v2.4: prevent "вот, вот, вот..." loops
        repetition_penalty=1.1,          # v2.4: discourage immediate repeats
    )
    return list(segments_iter), info


def extract_words(segments, label: str):
    """Flatten segments → list of (start, end, label, word_text, probability) tuples.

    Filter words below PROB_THRESHOLD on the spot — these are usually echo bleed
    from the OTHER channel (manager's mic picks up client's voice through speakers
    with ~50-100ms delay and -20dB attenuation; Whisper sees the bleed and produces
    low-confidence transcription).
    """
    words = []
    for seg in segments:
        if not seg.words:
            # Fallback: если без word_timestamps — берём весь сегмент с avg prob
            prob = getattr(seg, "avg_logprob", -1.0)
            # convert avg_logprob to probability-ish (rough)
            est_prob = 1.0 if prob > -0.3 else 0.5 if prob > -0.7 else 0.3
            if est_prob >= PROB_THRESHOLD:
                words.append((seg.start, seg.end, label, seg.text.strip(), est_prob))
            continue
        for w in seg.words:
            text = (w.word or "").strip()
            if not text:
                continue
            prob = getattr(w, "probability", 1.0)
            if prob < PROB_THRESHOLD:
                continue  # likely cross-channel bleed
            words.append((w.start, w.end, label, text, prob))
    return words


def load_wav_rms_lookup(wav_path: Path):
    """Load a wav file and return a function rms(start_s, end_s) → RMS amplitude.

    Used to gate echo: a word transcribed on channel X but with low RMS in
    channel X (and high RMS in the other channel at same time) is echo bleed.
    """
    try:
        wf = wave.open(str(wav_path), "rb")
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        frames = wf.readframes(n_frames)
        wf.close()
    except Exception as e:
        print(f"[wav-load-fail] {wav_path}: {e}", file=sys.stderr)
        return lambda s, e: 1.0  # fallback — never gate

    def rms(start_s: float, end_s: float) -> float:
        a = max(0, int(start_s * sample_rate)) * sample_width
        b = min(len(frames), int(end_s * sample_rate) * sample_width)
        if b <= a:
            return 0.0
        chunk = frames[a:b]
        if not chunk:
            return 0.0
        try:
            return float(audioop.rms(chunk, sample_width))
        except audioop.error:
            return 0.0

    return rms


def filter_echo_by_energy(words, rms_self, rms_other, ratio: float = ECHO_ENERGY_RATIO):
    """Drop words where the OTHER channel was N× louder during word time.

    Such words are physical echo bleed (other speaker's voice picked up by
    this channel's mic via speakers, with attenuation but real audio).
    """
    out = []
    for w in words:
        s, e, label, text, prob = w
        # Pad ±0.1s around word for stable RMS measurement
        rms_s = rms_self(s - 0.1, e + 0.1)
        rms_o = rms_other(s - 0.1, e + 0.1)
        # If other channel was much louder → this is echo, drop
        if rms_o > 0 and rms_s > 0 and (rms_o / rms_s) >= ratio:
            continue
        out.append(w)
    return out


def dedup_cross_channel_echo(words):
    """Drop echo-bleed duplicates between channels.

    For each pair of words (different channels) within ECHO_WINDOW_S of each other,
    if their texts are similar (one is substring of other, or share most chars),
    keep the one with HIGHER probability — this is the real voice; the other is
    bleed from speakers picked up by the other channel's mic.
    """
    # Sort by start time
    words.sort(key=lambda w: w[0])
    keep = [True] * len(words)

    for i, (s1, e1, l1, t1, p1) in enumerate(words):
        if not keep[i]:
            continue
        # Look forward within window
        for j in range(i + 1, len(words)):
            s2, e2, l2, t2, p2 = words[j]
            if s2 - s1 > ECHO_WINDOW_S:
                break  # too far, sorted
            if l1 == l2:
                continue  # same channel, not echo
            # Texts similar?
            t1_lc = t1.lower().strip(".,!?;:—-")
            t2_lc = t2.lower().strip(".,!?;:—-")
            if not t1_lc or not t2_lc:
                continue
            similar = (
                t1_lc == t2_lc
                or (len(t1_lc) >= 3 and len(t2_lc) >= 3 and (
                    t1_lc in t2_lc or t2_lc in t1_lc
                ))
            )
            if similar:
                # Drop the lower-probability one (the echo)
                if p1 >= p2:
                    keep[j] = False
                else:
                    keep[i] = False
                    break  # i dropped, no need to keep checking
    return [w for w, k in zip(words, keep) if k]


def merge_words_into_utterances(words, gap_threshold: float = GAP_THRESHOLD):
    """Legacy global merge — kept for tests. Use merge_channel_first() in production.

    PROBLEM: sorting all words by start_time globally interleaves overlapping
    channels into ping-pong — Whisper transcribes L/R independently, their word
    timestamps differ by tens of ms, so during real overlap (manager talking,
    client backchanneling) the merged stream alternates word-by-word instead of
    showing two parallel utterances. See merge_channel_first() for the fix.
    """
    words.sort(key=lambda w: w[0])
    utterances = []
    for w in words:
        w_start, w_end, label, text = w[0], w[1], w[2], w[3]
        if utterances:
            last_start, last_label, last_text = utterances[-1]
            last_end_estimate = utterances_end[-1] if utterances_end else last_start
            gap = w_start - last_end_estimate
            if last_label == label and gap <= gap_threshold:
                utterances[-1] = (last_start, last_label, last_text + " " + text)
                utterances_end[-1] = w_end
                continue
        utterances.append((w_start, label, text))
        utterances_end.append(w_end)
    return utterances


def merge_channel_first(mgr_words, cli_words, gap_threshold: float = GAP_THRESHOLD):
    """Channel-first merge: build per-channel utterances FIRST, then interleave.

    Whisper transcribes L and R channels independently — its word-level timestamps
    don't align perfectly with reality (drift ~50-200ms). When we sort the combined
    word stream by start_time, on real overlap zones (e.g., client backchanneling
    "ага/угу" while manager says "если можно"), the streams interleave word-by-word:

        L Ага,        64.78
        R Если        64.86  ← interleaves
        L это         65.44
        R можно,      65.64  ← interleaves
        L хорошо.     65.66

    This produces ping-pong that downstream AI can't parse. The fix:
    1. Build complete utterances PER CHANNEL (drift invisible — only that channel)
    2. THEN interleave the utterances by start time

    Result for the same zone:
        [КЛИЕНТ 01:04]   Ага, это хорошо.
        [МЕНЕДЖЕР 01:04] Если можно, ...
    """
    def build_channel_utterances(words):
        """Group consecutive words from one channel into utterances by gap."""
        words = sorted(words, key=lambda w: w[0])
        utts = []  # (start, end, label, text)
        for w in words:
            w_start, w_end, label, text = w[0], w[1], w[2], w[3]
            if utts:
                last_s, last_e, last_label, last_text = utts[-1]
                if (w_start - last_e) <= gap_threshold:
                    utts[-1] = (last_s, w_end, label, last_text + " " + text)
                    continue
            utts.append((w_start, w_end, label, text))
        return utts

    mgr_utts = build_channel_utterances(mgr_words)
    cli_utts = build_channel_utterances(cli_words)

    # Interleave by start time. Each utterance is now atomic — neither channel's
    # turn can be split by the other channel's words.
    all_utts = mgr_utts + cli_utts
    all_utts.sort(key=lambda u: u[0])

    return [(s, label, text) for s, e, label, text in all_utts]


# Module-level mutable state for end-times (used by merge func above)
utterances_end = []


# Known Whisper large-v3 hallucinations on silence/static fragments.
# Filter these out from final transcript so they don't confuse downstream AI.
HALLUCINATION_PATTERNS = [
    r"DimaTorzok", r"redactor.*субтитр", r"редактор.*субтитр",
    r"субтитр[ыов]?\s*создавал", r"субтитр[ыов]?\s*от", r"субтитры?\s*by",
    r"корректор\s*субтитр", r"перевод\s*и?\s*субтитры",
    r"спасибо\s*за\s*просмотр", r"thank.*for.*watching",
    r"продолжение\s*следует",        # Whisper invents on long silence at end of call
    r"^\s*звонок\s*телефона\s*$",    # ringtone description (single-line dial tone)
    r"^\s*звонок\s+(дверь|телефон)\s*$",  # v2.4: caps "ЗВОНОК ДВЕРЬ" hallucination
]
import re as _re
_HALLUCINATION_RE = _re.compile("|".join(HALLUCINATION_PATTERNS), _re.IGNORECASE)


def filter_whisper_hallucinations(utterances):
    """Drop utterances that match known Whisper hallucination patterns."""
    out = []
    for start, label, text in utterances:
        if _HALLUCINATION_RE.search(text):
            continue
        out.append((start, label, text))
    return out


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
    if not download(url, src, uuid=cid):
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
            ls, l_info = transcribe_one_channel(model, left)
            rs, _ = transcribe_one_channel(model, right)

            # v2.4: provider-aware role mapping.
            # Default convention (onPBX, Sipuni inbound): LEFT=МЕНЕДЖЕР, RIGHT=КЛИЕНТ.
            # Sipuni OUTBOUND inverts: agent goes to RIGHT, remote callee on LEFT.
            # (Verified on vastu outbound calls 2026-04-23 by 5-agent QA review.)
            provider = (row.get("provider") or "onpbx").lower()
            direction = (row.get("direction") or "in").lower()

            sipuni_outbound = provider == "sipuni" and direction in ("out", "outgoing")
            if sipuni_outbound:
                mgr_words = extract_words(rs, "МЕНЕДЖЕР")  # SWAPPED: right=manager
                cli_words = extract_words(ls, "КЛИЕНТ")    # SWAPPED: left=client
            else:
                mgr_words = extract_words(ls, "МЕНЕДЖЕР")
                cli_words = extract_words(rs, "КЛИЕНТ")

            # v2.2: ENERGY-based echo filter — open both channel WAVs, drop words
            # where the OTHER channel was loud (means this channel just heard echo).
            # Catches single-syllable echoes ("могу"/"два") that text-dedup missed.
            rms_left = load_wav_rms_lookup(left)
            rms_right = load_wav_rms_lookup(right)
            mgr_words = filter_echo_by_energy(mgr_words, rms_left, rms_right)
            cli_words = filter_echo_by_energy(cli_words, rms_right, rms_left)

            # Text-similar dedup across channels (v2.1) — needs combined list
            words = mgr_words + cli_words
            words = dedup_cross_channel_echo(words)

            # v2.3: split back by label and apply channel-first merge.
            # Builds per-channel utterances FIRST so Whisper's independent-timestamp
            # drift can't interleave overlapping channels into ping-pong fragments.
            mgr_words_clean = [w for w in words if w[2] == "МЕНЕДЖЕР"]
            cli_words_clean = [w for w in words if w[2] == "КЛИЕНТ"]
            utterances = merge_channel_first(mgr_words_clean, cli_words_clean)
            utterances = filter_whisper_hallucinations(utterances)

            text = format_transcript(utterances)
            # v2.4: raw_segments labels match actual role assignment (provider-aware)
            left_label = "КЛИЕНТ" if sipuni_outbound else "МЕНЕДЖЕР"
            right_label = "МЕНЕДЖЕР" if sipuni_outbound else "КЛИЕНТ"
            raw = {
                "left_segments": serialize_raw_segments(ls, left_label),
                "right_segments": serialize_raw_segments(rs, right_label),
                "merged_utterances": [
                    {"start": round(s, 3), "label": l, "text": t}
                    for s, l, t in utterances
                ],
                "role_mapping": {
                    "provider": provider, "direction": direction,
                    "sipuni_outbound": sipuni_outbound,
                },
            }
            mode = "stereo_channel_first_v24"
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
