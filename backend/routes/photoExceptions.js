const express = require("express");
const router = express.Router();
const db = require("../db");
const { normalizeIdentifier } = require("../services/photoRecognitionSettings");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

// Список чатов, в которых распознавание фото отключено (для всех сессий).
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT id, chat_identifier, created_at
      FROM photo_recognition_disabled_chats
      WHERE user_id = ?
      ORDER BY id DESC
      `,
      [getUserId(req)]
    );

    return res.json({
      success: true,
      chats: rows,
    });
  } catch (error) {
    console.error("Get photo exceptions error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить список чатов",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const raw = req.body.chatIdentifier ?? req.body.chatId ?? req.body.username;
    const identifier = normalizeIdentifier(raw);

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: "User ID или @username обязателен",
      });
    }

    const [exists] = await db.execute(
      `
      SELECT id
      FROM photo_recognition_disabled_chats
      WHERE user_id = ? AND chat_identifier = ?
      `,
      [getUserId(req), identifier]
    );

    if (exists.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Этот чат уже в списке",
      });
    }

    const [result] = await db.execute(
      `
      INSERT INTO photo_recognition_disabled_chats (user_id, chat_identifier)
      VALUES (?, ?)
      `,
      [getUserId(req), identifier]
    );

    return res.json({
      success: true,
      item: {
        id: result.insertId,
        chat_identifier: identifier,
      },
    });
  } catch (error) {
    console.error("Add photo exception error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось добавить чат в список",
    });
  }
});

router.delete("/", async (req, res) => {
  try {
    await db.execute(
      `
      DELETE FROM photo_recognition_disabled_chats
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    return res.json({
      success: true,
      message: "Список очищен",
    });
  } catch (error) {
    console.error("Clear photo exceptions error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось очистить список",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      `
      DELETE FROM photo_recognition_disabled_chats
      WHERE id = ? AND user_id = ?
      `,
      [id, getUserId(req)]
    );

    return res.json({
      success: true,
      message: "Запись удалена",
    });
  } catch (error) {
    console.error("Delete photo exception error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось удалить запись",
    });
  }
});

module.exports = router;
