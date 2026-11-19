#!/bin/bash
# Daily hard C audit → log + всегда короткий дайджест админу (OK или FAIL)
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
LOG_DIR=/root/logs
mkdir -p "$LOG_DIR"
STAMP=$(date -u +%Y%m%d_%H%M)
LOG="$LOG_DIR/audit_c_$STAMP.log"
export HARD_AUDIT_FAST=1
bash "$BASE/backend/scripts/_audit_c_full_now.sh" >"$LOG" 2>&1
EC=$?
tail -n 60 "$LOG" >>"$LOG_DIR/audit_c_latest.log" 2>/dev/null || true

SUMMARY=$(grep -E 'AUDIT_C_SUMMARY|AUDIT_C_OK|AUDIT_C_FAIL|P0=|P1=' "$LOG" | tail -6 | tr '\n' ' ' | sed 's/"/ /g')
if [ -z "$SUMMARY" ]; then
  SUMMARY="exit=$EC (см. $LOG)"
fi

# Всегда дайджест в TG (не только на FAIL)
cd "$BASE/backend" || exit 1
SUMMARY="$SUMMARY" EC="$EC" STAMP="$STAMP" node <<'NODE'
const { sendAdminAlert } = require('./services/helpRequestNotifier');
const ok = Number(process.env.EC || 1) === 0 && !/AUDIT_C_FAIL|P0=[1-9]/.test(process.env.SUMMARY || '');
const title = ok ? 'Audit C nightly OK' : 'Audit C nightly FAIL';
const body =
  `<b>${title}</b>\n` +
  `${String(process.env.SUMMARY || '').slice(0, 500)}\n` +
  `<code>${process.env.STAMP || ''}</code>`;
sendAdminAlert(body)
  .then(() => console.log('digest_sent', ok ? 'ok' : 'fail'))
  .catch((e) => {
    console.error('digest_fail', e.message);
    process.exitCode = 0;
  });
NODE

if [ "$EC" -ne 0 ] || grep -qE 'AUDIT_C_FAIL|P0=[1-9]' "$LOG"; then
  P0=$(grep -oE 'P0=[0-9]+' "$LOG" | tail -1 || echo P0=?)
  echo "AUDIT_C fail $P0 — $LOG" >>"$LOG_DIR/audit_c_alerts.log"
  exit 1
fi
echo "AUDIT_C_CRON_OK $STAMP" >>"$LOG_DIR/audit_c_latest.log"
exit 0
