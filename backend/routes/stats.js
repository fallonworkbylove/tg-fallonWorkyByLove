const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [userRows] = await db.execute(
      `
      SELECT balance
      FROM users
      WHERE id = ?
      `,
      [getUserId(req)]
    );

    const [messageRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM dialogs
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    const [accountRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM accounts
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    const [activeAccountRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM accounts
      WHERE user_id = ? AND is_autoreply_enabled = true
      `,
      [getUserId(req)]
    );

    const [messagesByAccount] = await db.execute(
      `
      SELECT 
        a.id,
        a.phone,
        COUNT(d.id) AS messages
      FROM accounts a
      LEFT JOIN dialogs d ON d.account_id = a.id
      WHERE a.user_id = ?
      GROUP BY a.id, a.phone
      ORDER BY messages DESC
      `,
      [getUserId(req)]
    );

    const user = userRows[0];

    return res.json({
      success: true,
      stats: {
        messages: messageRows[0]?.total || 0,
        referrals: 0,
        income: Number(user?.balance || 0).toFixed(2),
        accounts: accountRows[0]?.total || 0,
        activeAccounts: activeAccountRows[0]?.total || 0,
        messagesByAccount,
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