"""Fix truncated transcriptRepaired for long transcripts.
For transcripts >5500 chars: split into chunks <8000 chars, repair each, concatenate.
Then UPDATE CallRecord.transcriptRepaired in БД.
"""
import json, urllib.request, time, os, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-5deee3aaa42a4d9da0351db9fbf7ff61")
BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-chat"
GLOSSARY_PEOPLE = "Татьяна, Юрий, Вероника, Ольга, Ирина, Наталья, Надежда, Анастасия, Галина, Марина, Нелли, Лейла, Сергей, Аннель, Дарья, Людмила, Сарапулова, Земсков, Эйрих, Торшина, Зинченко, Костина, Попова, Штундер, Непочатых, Тышкевич, Архипова, Кейдалюк, Сергеева, Апексимова, Тесла, Дунаева, Храптович, Кузьменко, Погода, Дубровина"
GLOSSARY_PRODUCTS = "Школа Дива, Дива, Юлия Морозова, Ирина Довгалева, Месяц Дива, диво-клуб, тариф базис, повторный курс, демо-доступ, омоложение лица, омоложение тела, осанка, диагностика"

def chunk_transcript(text, max_chars=7500):
    """Split transcript by complete utterance blocks, NOT mid-line."""
    lines = text.split('\n')
    chunks = []; cur = []; cur_len = 0
    for ln in lines:
        if cur_len + len(ln) > max_chars and cur:
            chunks.append('\n'.join(cur)); cur = [ln]; cur_len = len(ln)
        else:
            cur.append(ln); cur_len += len(ln) + 1
    if cur: chunks.append('\n'.join(cur))
    return chunks

def build_repair_prompt(chunk_text):
    return f"""Исправь ASR-ошибки в транскрипции звонка по словарю продукта.

КЛИЕНТ: diva-school (Школа Дива Юлии Морозовой)
СЛОВАРЬ:
- Продукты: {GLOSSARY_PRODUCTS}
- Люди: {GLOSSARY_PEOPLE}
- Известные ошибки: Гивы→Дива, Гива→Дива, Дивора→Дива, Топгалёва→Довгалева, Завгалёвой→Довгалевой, месяц Киева→Месяц Дива, ВКонтакте, ОПЯТКИ→ПЯТКИ, плинтус, биотепсиры→биотензегрити (если контекст про мышцы)

ПРАВИЛА:
1. Исправляй ТОЛЬКО ошибки имён/терминов из словаря.
2. НЕ меняй смысл, НЕ перефразируй.
3. Сохраняй формат [SPEAKER MM:SS] timestamps.
4. Каждой строке оригинала — одна строка результата.

ОРИГИНАЛ:
{chunk_text}

ИСПРАВЛЕНО (только transcript, без объяснений):"""

def call_deepseek(prompt, max_tokens=8000):
    body = json.dumps({"model": MODEL, "messages": [{"role":"user","content":prompt}],
                       "temperature":0.0, "max_tokens": max_tokens}).encode()
    req = urllib.request.Request(f"{BASE_URL}/v1/chat/completions",
        data=body, method="POST",
        headers={"Content-Type":"application/json", "Authorization":f"Bearer {API_KEY}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"].strip()

def repair_long(text, retries=2):
    chunks = chunk_transcript(text, max_chars=7500)
    repaired_chunks = []
    for c in chunks:
        last_err = None
        for attempt in range(retries):
            try:
                rep = call_deepseek(build_repair_prompt(c))
                repaired_chunks.append(rep)
                break
            except Exception as e:
                last_err = e; time.sleep(3)
        else:
            repaired_chunks.append(c)  # fallback original
    return '\n'.join(repaired_chunks)

# MAIN
long_uuids = json.load(open('/tmp/backfill-839/v213-changed-uuids.json'))
transcripts = {}
for ln in open('/tmp/backfill-839/all-transcripts-v213.jsonl'):
    o = json.loads(ln); transcripts[o.get('id')] = o.get('transcript') or ''

print(f"[init] re-repairing {len(long_uuids)} long transcripts (concurrency=8)")

results = {}
write_lock = Lock()
counter = {'done': 0, 'fail': 0}
t0 = time.time()

def worker(uid):
    text = transcripts.get(uid, '')
    if not text: return
    try:
        repaired = repair_long(text)
        with write_lock:
            results[uid] = repaired
            counter['done'] += 1
    except Exception as e:
        with write_lock:
            counter['fail'] += 1
            print(f"  FAIL {uid[:8]}: {e}")
    n = counter['done'] + counter['fail']
    if n % 10 == 0:
        elapsed = time.time() - t0
        rate = n / max(elapsed, 1)
        eta = (len(long_uuids) - n) / max(rate, 0.01) / 60
        print(f"  [{n}/{len(long_uuids)}] done={counter['done']} fail={counter['fail']} ETA={eta:.1f}min")

with ThreadPoolExecutor(max_workers=15) as ex:
    list(as_completed([ex.submit(worker, u) for u in long_uuids]))

print(f"\n[done] {counter['done']} repaired in {(time.time()-t0)/60:.1f}min")

# Save SQL
with open('/tmp/backfill-839/repair-fix-v213.sql', 'w') as f:
    f.write("BEGIN;\n")
    for uid, rep in results.items():
        safe = rep.replace("'", "''")
        f.write(f"UPDATE \"CallRecord\" SET \"transcriptRepaired\"='{safe}' WHERE \"pbxUuid\"='{uid}';\n")
    f.write("COMMIT;\n")
print(f"SQL: /tmp/backfill-839/repair-fix-v213.sql")
