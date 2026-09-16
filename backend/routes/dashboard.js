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

    // Считаем сообщения из реальной таблицы истории переписок
    // (conversation_messages), а не из несуществующей "dialogs" —
    // раньше запрос падал на отсутствующей таблице и /api/dashboard
    // всегда отвечал 500.
    const [messagesRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM conversation_messages cm
      JOIN accounts a ON a.id = cm.account_id
      WHERE a.user_id = ?
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
