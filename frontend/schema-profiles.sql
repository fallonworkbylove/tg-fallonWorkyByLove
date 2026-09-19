-- Таблицы для анкет знакомств (MySQL)

CREATE TABLE IF NOT EXISTS workers (
  id BIGINT NOT NULL PRIMARY KEY COMMENT 'Telegram user.id воркера',
  login VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  worker_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  age INT NOT NULL,
  city VARCHAR(100) DEFAULT NULL,
  bio TEXT,
  tg_link VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(500) DEFAULT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  clicks INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_profiles_worker (worker_id),
  INDEX idx_profiles_active (active),
  CONSTRAINT fk_profiles_worker
    FOREIGN KEY (worker_id) REFERENCES workers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Пример воркера (id = Telegram user.id):
-- INSERT INTO workers (id, login, password_hash, token)
-- VALUES (123456789, 'worker1', 'unused', 'optional-token');
