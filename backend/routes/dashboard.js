const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [userRows] = await db.execute(
      `
      SELECT balance, account_limit, subscription_until
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

    const [messagesRows] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM dialogs
      WHERE user_id = ?
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

    const subscription =
      user.subscription_until &&
      new Date(user.subscription_until).getTime() > Date.now();

    return res.json({
      success: true,
      dashboard: {
        balance: Number(user.balance || 0).toFixed(2),
        subscription: Boolean(subscription),
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