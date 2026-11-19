#!/usr/bin/env python3
"""Live audit: errors + recent reply pairs from tgbot logs."""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/root/.pm2/logs/tgbot-out.log")
ERR = Path("/root/.pm2/logs/tgbot-error.log")


def read_tail(path: Path, nbytes: int) -> str:
    if not path.exists():
        return ""
    data = path.read_bytes()
    return data[-nbytes:].decode("utf-8", "replace")


def main() -> None:
    err = read_tail(ERR, 500_000)
    out = read_tail(OUT, 1_500_000)

    print("=== ERROR SUMMARY ===")
    print("err_mtime", datetime.fromtimestamp(ERR.stat().st_mtime, tz=timezone.utc).isoformat() if ERR.exists() else "missing")
    print("err_size", ERR.stat().st_size if ERR.exists() else 0)
    c = Counter()
    other = []
    for line in err.splitlines()[-1200:]:
        if "sessionForgetHint" in line:
            c["sessionForgetHint"] += 1
        elif "прокси" in line and "недоступен" in line:
            c["proxy_fail"] += 1
        elif "helpRequestNotifier" in line:
            c["help_poll"] += 1
        elif "Пустой AI" in line:
            c["empty_ai"] += 1
        elif any(x in line for x in ("Error", "Ошибка", "ReferenceError", "TypeError", "is not defined")):
            c["other_err"] += 1
            s = line.strip()[-200:]
            if s not in other and len(other) < 25:
                other.append(s)
    print("counts", dict(c))
    for o in other:
        print("OTHER:", o)

    print("\n=== RECENT DIALOG PAIRS ===")
    # Match: [account] Name: "msg"  and  [account] Ответ для Name: "reply"
    # Also without nested brackets carefully.
    events = []
    for m in re.finditer(
        r"\[([^\]]+)\]\s+(?:Ответ для\s+)?([^:\n]{1,40}):\s+\"([^\"]{1,300})\"",
        out,
    ):
        acct, who, text = m.group(1), m.group(2).strip(), m.group(3)
        kind = "bot" if "Ответ для" in m.group(0) or m.group(0).find("Ответ для") >= 0 else "user"
        # Detect bot lines more reliably
        if re.search(r"\]\s+Ответ для\s+", m.group(0)):
            kind = "bot"
            peer = who
        else:
            # user inbound: [acct] peer: "text"
            if "Ответ для" in m.group(0):
                kind = "bot"
                peer = who
            else:
                kind = "user"
                peer = who
        events.append({"acct": acct[:50], "peer": peer[:40], "kind": kind, "text": text.replace("\\n", " | ")})

    # Better parse: two separate patterns
    events = []
    for m in re.finditer(
        r"\[([^\]]+)\]\s+Ответ для\s+([^:]+):\s+\"([^\"]{1,280})\"",
        out,
    ):
        events.append({"acct": m.group(1)[:45], "peer": m.group(2).strip()[:40], "kind": "bot", "text": m.group(3)})
    for m in re.finditer(
        r"\[([^\]]+)\]\s+(?!Ответ для)([^:\n]{2,40}):\s+\"([^\"]{1,280})\"",
        out,
    ):
        peer = m.group(2).strip()
        if peer.startswith("Скан") or "Пауза" in peer or "Слишком" in peer:
            continue
        events.append({"acct": m.group(1)[:45], "peer": peer[:40], "kind": "user", "text": m.group(3)})

    # Keep last N by appearance order in file (already sequential in finditer)
    # Pair nearest user->bot per peer
    pairs = []
    last_user = {}
    for e in events:
        key = (e["acct"], e["peer"])
        if e["kind"] == "user":
            last_user[key] = e["text"]
        elif e["kind"] == "bot":
            pairs.append(
                {
                    "acct": e["acct"],
                    "peer": e["peer"],
                    "user": last_user.get(key, "?"),
                    "bot": e["text"],
                }
            )

    # Heuristic flags for inhuman replies
    flags_re = [
        (r"просто\s+познакомиться", "anketa_seek"),
        (r"рада\s+знакомству|приятно\s+познакомиться", "stiff_hello"),
        (r"не\s+гони", "rude_show"),
        (r"может\s+быть\s*\)?\s*$", "maybe_hedge"),
        (r"инст|instagram|держи\)|\[ссылк", "contact_leak"),
        (r"что\s+ок\s*\?|что\s+сложно\s*\?", "hollow_probe"),
        (r"не\s+поняла,?\s+что\s+спросила", "meta_confused"),
        (r"поддерживать\s+форму|для\s+тех,?\s+кто", "audience_voice"),
        (r"^(?:норм|ок|ага|угу|хз|да)\s*\)?$", "ultra_short"),
        (r"хах,?\s+не\s+поняла|не\s+совсем\s+поняла", "confusion"),
        (r"в\s+IT|это\s+в\s+айти", "svo_as_it"),
        (r"мошенник|не\s+кидаю", "unprompted_scam"),
        (r"^[\?]+\s*$", "bare_q"),
        (r"ну\s+не\s+знаю,?\s*может", "recruit_hedge"),
        (r"просто\s+общаюсь\s*\)?\s*$", "hollow_hobby"),
        (r"хорошего\s+дня|приятного\s+аппетита|удачной\s+прогулки", "formal_wish"),
    ]

    flagged = []
    for p in pairs[-120:]:
        hits = []
        for rx, name in flags_re:
            if re.search(rx, p["bot"], re.I):
                hits.append(name)
        if hits:
            flagged.append({**p, "flags": hits})

    print(json.dumps({"pairs_total": len(pairs), "flagged": flagged[-40:], "last_pairs": pairs[-35:]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
