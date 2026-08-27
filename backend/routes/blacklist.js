const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT id, user_telegram_id, created_at
      FROM blacklist
      WHERE user_id = ?
      ORDER BY id DESC
      `,
      [getUserId(req)]
    );

    return res.json({
      success: true,
      blacklist: rows,
    });
  } catch (error) {
    console.error("Get blacklist error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить blacklist",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const userTelegramId = req.body.userTelegramId || req.body.userId;

    if (!userTelegramId) {
      return res.status(400).json({
        success: false,
        error: "User ID обязателен",
      });
    }

    const [exists] = await db.execute(
      `
      SELECT id
      FROM blacklist
      WHERE user_id = ? AND user_telegram_id = ?
      `,
      [getUserId(req), userTelegramId]
    );

    if (exists.length > 0) {
      return res.status(400).json({
        success: false,
        error: "User ID уже есть в blacklist",
      });
    }

    const [result] = await db.execute(
      `
      INSERT INTO blacklist (user_id, user_telegram_id)
      VALUES (?, ?)
      `,
      [getUserId(req), userTelegramId]
    );

    return res.json({
      success: true,
      item: {
        id: result.insertId,
        user_telegram_id: userTelegramId,
      },
    });
  } catch (error) {
    console.error("Add blacklist error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось добавить User ID в blacklist",
    });
  }
});

router.delete("/", async (req, res) => {
  try {
    await db.execute(
      `
      DELETE FROM blacklist
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    return res.json({
      success: true,
      message: "Blacklist очищен",
    });
  } catch (error) {
    console.error("Clear blacklist error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось очистить blacklist",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      `
      DELETE FROM blacklist
      WHERE id = ? AND user_id = ?
      `,
      [id, getUserId(req)]
    );

    return res.json({
      success: true,
      message: "Запись удалена",
    });
  } catch (error) {
    console.error("Delete blacklist item error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось удалить запись blacklist",
    });
  }
});

module.exports = router;