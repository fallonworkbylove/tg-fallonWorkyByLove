const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [userRows] = await db.execute(
      `
      SELECT account_limit
      FROM users
      WHERE id = ?
      `,
      [getUserId(req)]
    );

    const [accountsRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM accounts
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    // Панель: сообщения за последние 24 часа (сутки).
    const [messagesRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM conversation_messages cm
      JOIN accounts a ON a.id = cm.account_id
      WHERE a.user_id = ?
        AND cm.created_at >= (NOW() - INTERVAL 1 DAY)
      `,
      [getUserId(req)]
    );

    const user = userRows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Пользователь не найден",
      });
    }

    return res.json({
      success: true,
      dashboard: {
        accountsUsed: accountsRows[0]?.total || 0,
        accountsLimit: user.account_limit || 10,
        messages: messagesRows[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Get dashboard error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить данные панели",
    });
  }
});

module.exports = router;
