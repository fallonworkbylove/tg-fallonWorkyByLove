import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
prompt = open("tmp_round_prompt.txt", encoding="utf-8").read()

for model in ["gemma2:9b", "qwen2.5:7b-instruct"]:
    t0 = time.time()
    body = json.dumps(
        {
            "model": model,
            "stream": False,
            "options": {"temperature": 0.45, "num_predict": 450},
            "prompt": prompt,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        out = json.loads(r.read().decode("utf-8"))
    resp = out.get("response", "")
    safe = model.replace(":", "_").replace("/", "_")
    open(f"tmp_bake_{safe}.txt", "w", encoding="utf-8").write(resp)
    print("====", model, f"{time.time() - t0:.1f}s", "====")
    print(resp[:1800])
    print()
