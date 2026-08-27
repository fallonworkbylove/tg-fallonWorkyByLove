const express = require("express");
const router = express.Router();
const db = require("../db");

function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT delay_min, delay_max
      FROM settings
      WHERE user_id = ?
      `,
      [getUserId(req)]
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: "Настройки не найдены",
      });
    }

    return res.json({
      success: true,
      options: {
        delayMin: rows[0].delay_min,
        delayMax: rows[0].delay_max,
      },
    });
  } catch (error) {
    console.error("Get options error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось получить настройки",
    });
  }
});

router.post("/delay", async (req, res) => {
  try {
    const { delayMin, delayMax } = req.body;

    const min = Number(delayMin);
    const max = Number(delayMax);

    if (Number.isNaN(min) || Number.isNaN(max)) {
      return res.status(400).json({
        success: false,
        error: "Задержка должна быть числом",
      });
    }

    if (min < 0) {
      return res.status(400).json({
        success: false,
        error: "Минимальная задержка не может быть меньше 0",
      });
    }

    if (max < min) {
      return res.status(400).json({
        success: false,
        error: "Максимальная задержка не может быть меньше минимальной",
      });
    }

    await db.execute(
      `
      UPDATE settings
      SET delay_min = ?, delay_max = ?
      WHERE user_id = ?
      `,
      [min, max, getUserId(req)]
    );

    return res.json({
      success: true,
      options: {
        delayMin: min,
        delayMax: max,
      },
    });
  } catch (error) {
    console.error("Update delay error:", error);

    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить настройки",
    });
  }
});

module.exports = router;