require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Разрешаем запросы от frontend и разбираем JSON-тело запросов.
app.use(cors());
app.use(express.json());

// Telegram WebApp initData verification middleware
const telegramAuth = require('./middleware/telegramAuth');
app.use(telegramAuth);

// Debug middleware: logs req.user and adds X-Debug-User header (dev only)
const debugUser = require('./middleware/debugUser');
app.use(debugUser);

// Routes
app.use('/api/accounts', require('./routes/accounts'));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/options", require("./routes/options"));
app.use("/api/blacklist", require("./routes/blacklist"));
app.use("/api/examples", require("./routes/examples"));
app.use("/api/stats", require("./routes/stats"));

// Базовая проверка доступности API.
app.get('/api/health', (req, res) => {
  try {
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});
const { bootstrapSessions } = require('./services/sessionBootstrap');

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  bootstrapSessions();
});
