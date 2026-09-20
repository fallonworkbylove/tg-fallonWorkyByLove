const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

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
    const payload = await computeStats(userId);
    const now = Date.now();

    return res.json({
      success: true,
      stats: {
        ...payload,
        computedAt: now,
        nextUpdateAt: now,
        cached: false,
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
