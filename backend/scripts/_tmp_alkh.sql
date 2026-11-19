SELECT id, created_at, role, LEFT(REPLACE(content,'\n',' '), 120)
FROM chat_logs
WHERE account_id=36 AND peer_id='8500448684' AND created_at>='2026-11-06 16:00:00'
ORDER BY id;
SELECT funnel_stage, focus, note, digest_sent_at
FROM operator_lead_flags
WHERE account_id=36 AND peer_id='8500448684';
