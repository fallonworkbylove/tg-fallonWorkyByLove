const express = require("express");
const router = express.Router();

// Задержка ответа задаётся только в карточке аккаунта.
// Старый /api/options/delay больше не сохраняет ничего.
router.get("/", async (_req, res) => {
  return res.json({ success: true, options: {} });
});

module.exports = router;
