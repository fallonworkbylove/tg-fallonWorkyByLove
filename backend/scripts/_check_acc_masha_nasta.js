require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });
  const [rows] = await c.query(
    "SELECT id, user_id, phone, status, is_autoreply_enabled, updated_at FROM accounts WHERE phone LIKE ? OR phone LIKE ? OR phone LIKE ? OR phone LIKE ?",
    ["%601878688%", "%322088586%", "%79601878688%", "%79322088586%"]
  );
  console.log(JSON.stringify(rows, null, 2));
  await c.end();
})().catch((e) => console.log("db_err", e.message));