#!/bin/bash
# Rollback AI reply brain to git 7c97b46 (2026-10-01) for day test.
# Exact 2026-10-09 snapshot was never committed (scp-only deploys).
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT"
SVC=backend/services
TS=$(date -u +%Y%m%dT%H%M%SZ)
BAK_DIR="$SVC/_bak_daytest_$TS"
mkdir -p "$BAK_DIR"

echo "[1] Backup current AI stack -> $BAK_DIR"
cp -a "$SVC/aiResponder.js" "$BAK_DIR/"
cp -a "$SVC/humanizeSpeech.js" "$BAK_DIR/" 2>/dev/null || true
cp -a "$SVC/lifeTexture.js" "$BAK_DIR/" 2>/dev/null || true
cp -a "$SVC/objectionHandler.js" "$BAK_DIR/" 2>/dev/null || true
# Keep a stable pointer for easy restore
ln -sfn "$(basename "$BAK_DIR")" "$SVC/_bak_daytest_CURRENT"
echo "BACKUP=$BAK_DIR" > "$SVC/_bak_daytest_CURRENT/README.txt" 2>/dev/null || \
  echo "BACKUP=$BAK_DIR" > "$BAK_DIR/README.txt"

echo "[2] Restore aiResponder from 7c97b46 (2026-10-01)"
git show 7c97b46:backend/services/aiResponder.js > "$SVC/aiResponder.js"

echo "[3] Patch missing heJustGreeted for current telegramClient"
python3 - <<'PY'
from pathlib import Path
p = Path("/root/opt/tgbot/tg-miniapp-loverussian/backend/services/aiResponder.js")
text = p.read_text(encoding="utf-8")
if "function heJustGreeted" not in text:
    shim = '''
/** Shim for telegramClient (added for day-test rollback compatibility). */
function heJustGreeted(userMessage) {
  const msg = String(userMessage || '')
    .replace(/\\[[^\\]]*\\]/g, ' ')
    .replace(/https?:\\/\\/\\S+/gi, ' ')
    .trim();
  if (!msg) return false;
  return /^(?:привет|приветик|прив|здаров|здарова|здравствуй|хай|хей|йо|салют|hi|hello|hey)\\b/i.test(msg)
    && msg.split(/\\s+/).length <= 6;
}
'''
    # insert before Object.assign(module.exports
    anchor = "Object.assign(module.exports,"
    idx = text.rfind(anchor)
    if idx < 0:
        raise SystemExit("cannot find module.exports assign")
    text = text[:idx] + shim + "\n" + text[idx:]
    # add to exports list
    text = text.replace(
        "Object.assign(module.exports, {",
        "Object.assign(module.exports, {\n  heJustGreeted,",
        1,
    )
    p.write_text(text, encoding="utf-8")
    print("patched heJustGreeted")
else:
    print("heJustGreeted already present")
PY

echo "[4] Syntax check"
node --check "$SVC/aiResponder.js"

echo "[5] Require smoke (no OpenAI call)"
cd backend
OPENAI_API_KEY=local-smoke-only node -e "const a=require('./services/aiResponder'); if(typeof a.generateReply!=='function') process.exit(2); if(typeof a.heJustGreeted!=='function') process.exit(3); console.log('smoke ok', typeof a.generateReply, typeof a.heJustGreeted);"

echo "[6] Restart tgbot"
pm2 restart tgbot --update-env
sleep 2
pm2 pid tgbot
pm2 show tgbot | grep -E 'status|uptime|unstable' | head -5
echo "DONE rollback to 7c97b46 (+heJustGreeted shim). Restore from: $BAK_DIR"
