const express = require("express");
const router = express.Router();
const db = require("../db");
const { isBetaTester } = require("../services/featureFlags");
const operatorAccess = require("../services/operatorAccess");

const getUserId = require('../lib/getUserId');

router.get("/", async (req, res) => {
  try {
    const [userRows] = await db.execute(
      `
      SELECT balance, account_limit, subscription_until, telegram_user_id, username
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

    // Сообщения считаем по conversation_messages (там реальная переписка).
    // Таблица dialogs в базе есть, но в неё никто не пишет — COUNT оттуда
    // всегда возвращал 0, и на панели было «0 сообщений».
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

    const subscription =
      user.subscription_until &&
      new Date(user.subscription_until).getTime() > Date.now();

    const tgId = req.telegramUser?.id ?? user.telegram_user_id;
    const uname = req.telegramUser?.username || user.username;
    let isAdmin = false;
    try {
      isAdmin = await operatorAccess.isAdmin(tgId, uname);
    } catch (_) {
      isAdmin = false;
    }

    return res.json({
      success: true,
      dashboard: {
        balance: Number(user.balance || 0).toFixed(2),
        subscription: Boolean(subscription),
        accountsUsed: accountsRows[0]?.total || 0,
        accountsLimit: user.account_limit || 10,
        messages: messagesRows[0]?.total || 0,
        isBetaTester: isBetaTester(req.dbUser || user),
        isAdmin: Boolean(isAdmin),
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
