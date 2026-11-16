#!/bin/bash
# Daily hard C audit → log + ADMIN_ALERT on P0
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
LOG_DIR=/root/logs
mkdir -p "$LOG_DIR"
STAMP=$(date -u +%Y%m%d_%H%M)
LOG="$LOG_DIR/audit_c_$STAMP.log"
bash "$BASE/backend/scripts/_audit_c_full_now.sh" >"$LOG" 2>&1
EC=$?
tail -n 40 "$LOG" >>"$LOG_DIR/audit_c_latest.log" 2>/dev/null || true
if [ "$EC" -ne 0 ] || grep -q 'AUDIT_C_FAIL\|P0=' "$LOG"; then
  P0=$(grep -oE 'P0=[0-9]+' "$LOG" | tail -1 || echo P0=?)
  MSG="AUDIT_C fail $P0 — $LOG"
  echo "$MSG" >>"$LOG_DIR/audit_c_alerts.log"
  if [ -n "${ADMIN_ALERT_URL:-}" ]; then
    curl -sS -X POST "$ADMIN_ALERT_URL" -H 'Content-Type: application/json' \
      -d "{\"text\":\"$MSG\"}" >/dev/null 2>&1 || true
  fi
  # soft: notifier via help bot if wired
  cd "$BASE/backend" && node -e "
    try {
      const h=require('./services/helpRequestNotifier');
      if (typeof h.alertAdmin==='function') h.alertAdmin('AUDIT_C', process.env.MSG||'fail');
    } catch(_) {}
  " 2>/dev/null || true
  exit 1
fi
echo "AUDIT_C_CRON_OK $STAMP" >>"$LOG_DIR/audit_c_latest.log"
exit 0
