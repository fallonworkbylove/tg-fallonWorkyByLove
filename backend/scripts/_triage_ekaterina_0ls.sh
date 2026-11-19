#!/bin/bash
echo "=== triage Екатерина / Александр / коробок ==="
grep -aE 'Екатерина Рябова|Александр|коробок|для тебя|без фото' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -60
echo "--- err ---"
grep -aE 'Екатерина|photo|vision|распознав' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20
echo "--- outbound media ekaterina ---"
grep -aE '79322184746|Екатерина' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | grep -aE 'outbound|Ответ для|photo|vision|caption' | tail -40
