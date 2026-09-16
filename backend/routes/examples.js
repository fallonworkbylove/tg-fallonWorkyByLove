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

async function resolveAccountId(req, accountId) {
  if (!accountId || accountId === "all") return null;
  const finalAccountId = Number(accountId);
  if (Number.isNaN(finalAccountId)) {
    const error = new Error("Некорректный accountId");
    error.statusCode = 400;
    throw error;
  }
  const [accountRows] = await db.execute(
    `SELECT id FROM accounts WHERE id = ? AND user_id = ?`,
    [finalAccountId, getUserId(req)],
  );
  if (accountRows.length === 0) {
    const error = new Error("Аккаунт не найден");
    error.statusCode = 404;
    throw error;
  }
  return finalAccountId;
}

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { accountId, clientMessage, correctAnswer, note } = req.body;

    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: "Некорректный id" });
    }
    if (!clientMessage || !String(clientMessage).trim()) {
      return res.status(400).json({ success: false, error: "Сообщение клиента обязательно" });
    }
    if (!correctAnswer || !String(correctAnswer).trim()) {
      return res.status(400).json({ success: false, error: "Правильный ответ обязателен" });
    }

    const finalAccountId = await resolveAccountId(req, accountId);
    const [result] = await db.execute(
      `UPDATE training_examples
       SET account_id = ?, client_message = ?, correct_answer = ?, note = ?
       WHERE id = ? AND user_id = ?`,
      [
        finalAccountId,
        String(clientMessage).trim(),
        String(correctAnswer).trim(),
        note ? String(note).trim() : null,
        id,
        getUserId(req),
      ],
    );

    if (result.affectedRows === 0) {
      const [rows] = await db.execute(
        `SELECT id FROM training_examples WHERE id = ? AND user_id = ? LIMIT 1`,
        [id, getUserId(req)],
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, error: "Пример не найден" });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Update example error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : "Не удалось изменить пример",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: "Некорректный id" });
    }

    const [result] = await db.execute(
      `DELETE FROM training_examples WHERE id = ? AND user_id = ?`,
      [id, getUserId(req)],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "Пример не найден" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Delete example error:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось удалить пример",
    });
  }
});

module.exports = router;