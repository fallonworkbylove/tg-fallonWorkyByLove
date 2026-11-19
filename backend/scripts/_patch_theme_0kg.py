#!/usr/bin/env python3
"""0kg: black + acid green theme, fonts, overflow safety."""
from pathlib import Path

ROOT = Path(r'C:/Users/lox/Desktop/tg-fallonWorkyByLove-main')
css = ROOT / 'frontend' / 'styles.css'
html = ROOT / 'frontend' / 'index.html'
app = ROOT / 'frontend' / 'app.js'

s = css.read_text(encoding='utf-8')

# --- palette remap warm terracotta → acid green ---
replacements = [
    ('#e8a07a', '#b8ff3c'),
    ('#d4784a', '#86e000'),
    ('#f0b892', '#d4ff6e'),
    ('#f6c4a0', '#e0ff8a'),
    ('#c86a3e', '#6bc400'),
    ('#efc29a', '#c8f26a'),
    ('#f0c9a8', '#d4ff6e'),
    ('#f7f3ec', '#eefbe0'),
    ('#f2efe8', '#e8ffe0'),
    ('#ddd7cf', '#cfe6c4'),
    ('#d8cfc4', '#c5dcb8'),
    ('#c8c0b4', '#a8c09a'),
    ('#b8b0a4', '#8fa888'),
    ('#9a958c', '#7f9278'),
    ('#8f877c', '#6d7f68'),
    ('#d8e4ea', '#d6ff9a'),
    ('#9eb4c2', '#9fd84a'),
    ('rgba(232, 160, 122,', 'rgba(184, 255, 60,'),
    ('rgba(212, 120, 74,', 'rgba(134, 224, 0,'),
    ('rgba(242, 239, 232,', 'rgba(232, 255, 224,'),
    ('rgba(243, 239, 232,', 'rgba(232, 255, 224,'),
    ('rgba(244, 241, 236,', 'rgba(232, 255, 224,'),
    ('#0a0b0d', '#050605'),
    ('#14161a', '#0c100c'),
    ('#12141a', '#0a0e0a'),
    ('#10131a', '#080c08'),
    ('#12141a', '#0a0e0a'),
    ('#15181e', '#0d120d'),
    ('#2a2e36', '#1a2418'),
    ('#1a120e', '#061006'),
    ('#5a5248', '#3d4a38'),
]
for a, b in replacements:
    s = s.replace(a, b)

# Force :root block (idempotent-ish)
root = ''':root {
  color-scheme: dark;
  --bg: #050605;
  --graphite: #0c100c;
  --bg-elevated: #0f140f;
  --card: rgba(10, 16, 10, 0.96);
  --text: #e8ffe0;
  --muted: #7f9278;
  --primary: #b8ff3c;
  --primary-strong: #86e000;
  --primary-soft: rgba(184, 255, 60, 0.14);
  --accent-cool: rgba(80, 120, 90, 0.12);
  --accent-warm: rgba(184, 255, 60, 0.16);
  --accent-pink: var(--accent-warm);
  --danger: #ff5a6a;
  --danger-strong: #d63a4a;
  --border: rgba(184, 255, 60, 0.1);
  --border-strong: rgba(184, 255, 60, 0.2);
  --shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  --radius: 14px;
  --font: "DM Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --display: "Space Grotesk", "DM Sans", system-ui, sans-serif;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}'''

import re
s = re.sub(r':root\s*\{[^}]*\}', root, s, count=1)

body_bg = '''body {
  margin: 0;
  font-family: var(--font);
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 70% 45% at 12% -8%, rgba(184, 255, 60, 0.12), transparent 55%),
    radial-gradient(ellipse 45% 35% at 100% 0%, rgba(60, 100, 70, 0.16), transparent 50%),
    linear-gradient(180deg, #0a0e0a 0%, var(--bg) 42%);
  background-attachment: fixed;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}'''
s = re.sub(r'body\s*\{[^}]*\}', body_bg, s, count=1)

overflow_block = '''
/* ——— 0kg: ровные края, без выступов ——— */
.app-shell,
.content,
.tab-panel,
.section-card,
.card,
.form-grid,
.activity-card,
.connect-card,
.modal-card,
.drawer-card {
  min-width: 0;
  max-width: 100%;
}
.content,
.tab-panel,
.section-card,
.card {
  overflow-x: hidden;
}
.workspace {
  overflow-x: hidden;
}
img,
svg,
video,
canvas {
  max-width: 100%;
  height: auto;
}
'''
if '0kg: ровные края' not in s:
    s += '\n' + overflow_block

# Splash on pure black+acid
s = s.replace(
    'var(--graphite);\n  color: var(--text);',
    '#050605;\n  color: var(--text);',
)

css.write_text(s, encoding='utf-8')
print('css_theme_ok')

# --- fonts in index.html ---
h = html.read_text(encoding='utf-8')
h = h.replace(
    'family=Manrope:wght@400;500;600;700&family=Syne:wght@600;700;800',
    'family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Grotesk:wght@500;600;700',
)
h = h.replace('styles.css?v=85', 'styles.css?v=86')
h = h.replace('updates.js?v=211', 'updates.js?v=212')
h = h.replace('app.js?v=174', 'app.js?v=175')
# splash heart gradient stops already remapped via css file for SVG? SVG is inline in html
h = h.replace('stop-color="#2a2e36"', 'stop-color="#1a2418"')
h = h.replace('stop-color="#15181e"', 'stop-color="#0d120d"')
h = h.replace('stop-color="#f2efe8"', 'stop-color="#e8ffe0"')
h = h.replace('stop-color="#e8a07a"', 'stop-color="#b8ff3c"')
html.write_text(h, encoding='utf-8')
print('html_ok')

# --- hang: splash watchdog + always clear ---
js = app.read_text(encoding='utf-8')
old_boot = '''function setBootStatus(text) {
  const splash = document.getElementById('app-splash');
  const legacy = document.getElementById('tg-boot-status');
  if (legacy) legacy.remove();

  if (!splash) return;

  if (!text) {
    splash.classList.add('is-done');
    splash.setAttribute('aria-busy', 'false');
    window.setTimeout(() => {
      splash.hidden = true;
      splash.classList.remove('is-done');
    }, 320);
    return;
  }

  splash.hidden = false;
  splash.classList.remove('is-done');
  splash.setAttribute('aria-busy', 'true');
  const status = document.getElementById('app-splash-status');
  if (status) status.textContent = text;
}'''

new_boot = '''let splashWatchdog = null;

function clearSplashWatchdog() {
  if (splashWatchdog) {
    clearTimeout(splashWatchdog);
    splashWatchdog = null;
  }
}

function hideAppSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  clearSplashWatchdog();
  splash.classList.add('is-done');
  splash.setAttribute('aria-busy', 'false');
  window.setTimeout(() => {
    splash.hidden = true;
    splash.classList.remove('is-done');
  }, 320);
}

function setBootStatus(text) {
  const splash = document.getElementById('app-splash');
  const legacy = document.getElementById('tg-boot-status');
  if (legacy) legacy.remove();

  if (!splash) return;

  if (!text) {
    hideAppSplash();
    return;
  }

  splash.hidden = false;
  splash.classList.remove('is-done');
  splash.setAttribute('aria-busy', 'true');
  const status = document.getElementById('app-splash-status');
  if (status) status.textContent = text;
  clearSplashWatchdog();
  // Анти-hang: splash не может висеть вечно даже если loadAllData завис.
  splashWatchdog = window.setTimeout(() => {
    hideAppSplash();
  }, 12000);
}'''

if old_boot not in js:
    raise SystemExit('setBootStatus block missing')
js = js.replace(old_boot, new_boot, 1)

# initializeApp finally always hide splash (except gate showing)
old_finally = '''  } finally {
    // Убираем «Загрузка…» если startApp уже отрисовал UI.
    if (document.querySelector('.app-shell')?.style.display !== 'none') {
      const gate = document.getElementById('tg-gate');
      if (!gate || gate.hidden) setBootStatus('');
    }
  }
}'''
new_finally = '''  } finally {
    const gate = document.getElementById('tg-gate');
    const shell = document.querySelector('.app-shell');
    const gateVisible = gate && !gate.hidden;
    const shellHidden = shell && shell.style.display === 'none';
    if (!gateVisible && !shellHidden) hideAppSplash();
  }
}'''
if old_finally not in js:
    raise SystemExit('finally block missing')
js = js.replace(old_finally, new_finally, 1)
app.write_text(js, encoding='utf-8')
print('app_hang_ok')
print('DONE_0kg_patch')
