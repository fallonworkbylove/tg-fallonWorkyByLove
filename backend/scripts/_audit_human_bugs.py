#!/usr/bin/env python3
"""Static audit: anti-human bugs in aiResponder reaction banks + finalize risks."""
import re
from pathlib import Path

root = Path("/root/opt/tgbot/tg-miniapp-loverussian/backend/services")
# fallback local
for p in [
    root / "aiResponder.js",
    Path(__file__).resolve().parents[1] / "services" / "aiResponder.js",
]:
    if p.exists():
        src = p.read_text(encoding="utf-8", errors="replace")
        print("file", p)
        break
else:
    raise SystemExit("aiResponder not found")

findings = []

def note(sev, msg):
    findings.append((sev, msg))

# Bad phrases still in pools
for bad in [
    "фигня какая",
    "ага, потом",
    "мм не знаю сходу",
    "сложно так сразу",
    "хз сразу",
    "нуждается в поддержке",
    "хороший подход",
    "зависит от восприятия",
]:
    # count in string literals only roughly
    n = len(re.findall(re.escape(bad), src, flags=re.I))
    if n:
        note("warn" if n <= 2 else "high", f"literal «{bad}» x{n} still in source")

# ASK_DODGE still has потом?
m = re.search(r"ASK_DODGE_ALTS\s*=\s*\[([\s\S]*?)\]", src)
if m:
    block = m.group(1)
    if re.search(r"потом|сходу|сложно так сразу", block, re.I):
        note("high", "ASK_DODGE_ALTS still has потом/сходу/сложно")
    else:
        note("ok", "ASK_DODGE_ALTS clean of потом/сходу")

# STORY_REACT / pickTopicAware still has dismissive
for name in ["STORY_REACT_RU", "FRIENDLY_OFFER_REACT"]:
    m = re.search(rf"{name}\s*=\s*\[([\s\S]*?)\]", src)
    if m and re.search(r"фигня", m.group(1), re.I):
        note("high", f"{name} still has фигня")

# sessionForgetHint scope bug pattern: const inside try then use after finally
tc = (root / "telegramClient.js")
if not tc.exists():
    tc = Path(__file__).resolve().parents[1] / "services" / "telegramClient.js"
if tc.exists():
    tcs = tc.read_text(encoding="utf-8", errors="replace")
    # look for const sessionForgetHint inside try blocks poorly
    if "sessionForgetHint снаружи try" in tcs or "ВАЖНО: sessionForgetHint" in tcs:
        note("ok", "sessionForgetHint fix comment present")
    # dangerous: const sessionForgetHint after try { without being outside
    # count uses after finally nearby - soft check
    if re.search(r"try\s*\{[^}]{0,200}const sessionForgetHint", tcs, re.S):
        note("high", "sessionForgetHint still declared inside try somewhere")
    else:
        note("ok", "no const sessionForgetHint inside compact try")

# fixCoachSpeak / fixDismissive exports wired?
for fn in [
    "fixCoachSpeak",
    "fixDismissiveOnFriendly",
    "fixEmptyNodOnSubstance",
    "fixZhestFillerSpam",
    "fixMomSupportFormal",
    "fixGenericAskDodge",
]:
    if f"{fn}(" not in src:
        note("high", f"{fn} never called?")
    elif src.count(fn) < 2:
        note("warn", f"{fn} defined but maybe not wired (count={src.count(fn)})")

# Weak: mom age vs duration conflict
if re.search(r"сколько[^\n]{0,40}лет[^\n]{0,80}пару дней", src, re.I | re.S):
    note("warn", "possible age→duration nearby")

# pickStoryReact filters жесть but not фигня - already removed

print("\n=== FINDINGS ===")
for sev, msg in findings:
    print(f"[{sev}] {msg}")

# Live log flags from out
outp = Path("/root/.pm2/logs/tgbot-out.log")
if outp.exists():
    out = outp.read_bytes()[-500_000:].decode("utf-8", "replace")
    bots = re.findall(r'Ответ для [^:]+: "([^"]{1,200})"', out)
    flags = {
        "фигня": 0,
        "сходу": 0,
        "сложно так сразу": 0,
        "нуждается": 0,
        "хороший подход": 0,
        "не теряй надежд": 0,
        "всегда есть шанс": 0,
        "рада видеть": 0,
        "жесть, прикольно": 0,
    }
    recent_bad = []
    for t in bots[-100:]:
        low = t.lower()
        for k in flags:
            if k in low:
                flags[k] += 1
                recent_bad.append(t)
    print("\n=== LIVE last100 reply hits ===")
    print(flags)
    for t in recent_bad[-15:]:
        print(" ", t)
