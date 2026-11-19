from pathlib import Path

css = Path(r'C:/Users/lox/Desktop/tg-fallonWorkyByLove-main/frontend/styles.css')
s = css.read_text(encoding='utf-8')
if '.app-splash__status' not in s:
    s = s.replace(
        '.app-splash__dots {',
        '''.app-splash__status {
  margin: 28px 20px 0;
  max-width: 280px;
  text-align: center;
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--muted);
  line-height: 1.4;
}

.app-splash__dots {''',
        1,
    )
    css.write_text(s, encoding='utf-8')
    print('css_status_ok')
else:
    print('css_status_exists')

app = Path(r'C:/Users/lox/Desktop/tg-fallonWorkyByLove-main/frontend/app.js')
js = app.read_text(encoding='utf-8')
needle = (
    "splash.hidden = false;\n"
    "  splash.classList.remove('is-done');\n"
    "  splash.setAttribute('aria-busy', 'true');\n"
    "}"
)
repl = (
    "splash.hidden = false;\n"
    "  splash.classList.remove('is-done');\n"
    "  splash.setAttribute('aria-busy', 'true');\n"
    "  const status = document.getElementById('app-splash-status');\n"
    "  if (status) status.textContent = text;\n"
    "}"
)
if needle not in js:
    raise SystemExit('needle missing in app.js')
app.write_text(js.replace(needle, repl, 1), encoding='utf-8')
print('app_status_ok')
