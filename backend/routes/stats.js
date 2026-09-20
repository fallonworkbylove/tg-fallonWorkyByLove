const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

/** Кэш «настоящих» статов: пересчёт не чаще раза в час на пользователя. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const statsCache = new Map();

async function computeStats(userId) {
  const [messageRows] = await db.execute(
    `
    SELECT COUNT(*) AS total
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE a.user_id = ?
    `,
    [userId]
  );

  const [accountRows] = await db.execute(
    `
    SELECT COUNT(*) AS total
    FROM accounts
    WHERE user_id = ?
    `,
    [userId]
  );

  const [activeAccountRows] = await db.execute(
    `
    SELECT COUNT(*) AS total
    FROM accounts
    WHERE user_id = ? AND is_autoreply_enabled = true
    `,
    [userId]
  );

  const [messagesByAccount] = await db.execute(
    `
    SELECT
      a.id,
      a.phone,
      COUNT(cm.id) AS messages
    FROM accounts a
    LEFT JOIN conversation_messages cm ON cm.account_id = a.id
    WHERE a.user_id = ?
    GROUP BY a.id, a.phone
    ORDER BY messages DESC
    `,
    [userId]
  );

  return {
    messages: Number(messageRows[0]?.total) || 0,
    accounts: Number(accountRows[0]?.total) || 0,
    activeAccounts: Number(activeAccountRows[0]?.total) || 0,
    messagesByAccount,
  };
}

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const force = String(req.query.refresh || "") === "1";
    const now = Date.now();
    const cached = statsCache.get(userId);

    let payload;
    let fromCache = false;

    if (!force && cached && now - cached.at < CACHE_TTL_MS) {
      payload = cached.data;
      fromCache = true;
    } else {
      payload = await computeStats(userId);
      statsCache.set(userId, { at: now, data: payload });
    }

    const computedAt = fromCache ? cached.at : now;

    return res.json({
      success: true,
      stats: {
        ...payload,
        computedAt,
        nextUpdateAt: computedAt + CACHE_TTL_MS,
        cached: fromCache,
      },
    });
  } catch (error) {
    console.error("Get stats error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить статистику",
    });
  }
});

module.exports = router;
