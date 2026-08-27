const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT 
        te.id,
        te.account_id,
        a.phone,
        te.client_message,
        te.correct_answer,
        te.note,
        te.created_at
      FROM training_examples te
      LEFT JOIN accounts a ON a.id = te.account_id
      WHERE te.user_id = ?
      ORDER BY te.id DESC
      `,
      [getUserId(req)]
    );

    return res.json({
      success: true,
      examples: rows,
    });
  } catch (error) {
    console.error("Get examples error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить примеры",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { accountId, clientMessage, correctAnswer, note } = req.body;

    if (!clientMessage || !clientMessage.trim()) {
      return res.status(400).json({
        success: false,
        error: "Сообщение клиента обязательно",
      });
    }

    if (!correctAnswer || !correctAnswer.trim()) {
      return res.status(400).json({
        success: false,
        error: "Правильный ответ обязателен",
      });
    }

    let finalAccountId = null;

    if (accountId && accountId !== "all") {
      finalAccountId = Number(accountId);

      if (Number.isNaN(finalAccountId)) {
        return res.status(400).json({
          success: false,
          error: "Некорректный accountId",
        });
      }

      const [accountRows] = await db.execute(
        `
        SELECT id
        FROM accounts
        WHERE id = ? AND user_id = ?
        `,
        [finalAccountId, getUserId(req)]
      );

      if (accountRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Аккаунт не найден",
        });
      }
    }

    const [result] = await db.execute(
      `
      INSERT INTO training_examples 
      (user_id, account_id, client_message, correct_answer, note)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        getUserId(req),
        finalAccountId,
        clientMessage.trim(),
        correctAnswer.trim(),
        note ? note.trim() : null,
      ]
    );

    return res.json({
      success: true,
      example: {
        id: result.insertId,
        user_id: getUserId(req),
        account_id: finalAccountId,
        client_message: clientMessage.trim(),
        correct_answer: correctAnswer.trim(),
        note: note ? note.trim() : null,
      },
    });
  } catch (error) {
    console.error("Add example error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить пример",
    });
  }
});

module.exports = router;