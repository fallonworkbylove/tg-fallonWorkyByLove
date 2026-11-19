const mysql = require('mysql2/promise');

// Общий пул: NFT-тики + inbound + ops делят соединения.
// DB_POOL_LIMIT (default 25), DB_POOL_QUEUE (default 200).
const connectionLimit = Math.max(
  5,
  Math.min(80, Number(process.env.DB_POOL_LIMIT) || 25),
);
const queueLimit = Math.max(
  0,
  Math.min(2000, Number(process.env.DB_POOL_QUEUE) || 200),
);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit,
  queueLimit,
  // Держим TCP живым и режем простаивающие — меньше ECONNREFUSED после паузы MySQL.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  idleTimeout: Number(process.env.DB_POOL_IDLE_MS) || 60_000,
  maxIdle: Math.max(2, Math.min(connectionLimit, Number(process.env.DB_POOL_MAX_IDLE) || 8)),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 8_000,
});

module.exports = pool;
