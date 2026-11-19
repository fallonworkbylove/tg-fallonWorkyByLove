# LoveRussian OPS — Android WebView

Открывает `https://loverussian.duckdns.org/ops/` в WebView.

Ключ **не зашит** в APK: вставь `ADMIN_CONSOLE_TOKEN` в Настройках один раз.

(Отдельный origin `ops-loverussian.duckdns.org` — когда появится DNS-запись.)

## Сборка APK (Windows)

```bat
gradlew.bat assembleDebug
```

или `.\build-apk.ps1`

APK: `app\build\outputs\apk\debug\app-debug.apk`

## Установка

1. Скопируй APK на телефон.
2. Разреши установку из неизвестных источников.
3. Установи → открой.
4. Настройки → вставь ключ консоли → Сохранить.
