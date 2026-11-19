# LoveRussian OPS

Десктоп-приложение для Windows и macOS. Вне Telegram / Mini App.

## Что внутри

- сводка: сообщения день / неделя / месяц, аккаунты, онлайн, AI
- канбан воронки: Знакомство → Общение → Интерес → Предложка → Оператор → Отсев
- фильтры: все / ждут ответа / ИИ / оператор
- автообновление

Дизайн: минималистичный фиолетово-розовый.

## Запуск

1. Node.js 18+ — https://nodejs.org/
2. `config.json` с токеном (уже есть рядом, или скопируй из `config.example.json`)
3. **Windows:** `start-windows.cmd`  
   **Mac:** `start-mac.command`

Первый запуск поставит Electron (~1–2 мин).

Или вручную:

```bash
cd ops-console
npm install
npm start
```

Только терминал (без окна):

```bash
npm run cli
```
