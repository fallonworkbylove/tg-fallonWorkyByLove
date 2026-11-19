from pathlib import Path

ROOT = Path(r'C:/Users/lox/Desktop/tg-fallonWorkyByLove-main')
header = "process.env.AUDIT_SMOKE = '1';\nprocess.env.OPENAI_PROXY_LIST = '';\n"
files = [
    'backend/scripts/_smoke_screen_bugs_0jz.js',
    'backend/scripts/_smoke_media_ack_refuse_0jy.js',
    'backend/scripts/_smoke_goodnight_silence_0jy.js',
    'backend/scripts/_smoke_activity_filter_0ke.js',
    'backend/scripts/_smoke_howlong_parse.js',
    'backend/scripts/_smoke_ops_quality.js',
]
for rel in files:
    p = ROOT / rel
    if not p.exists():
        print('miss', rel)
        continue
    t = p.read_text(encoding='utf-8')
    if 'AUDIT_SMOKE' in t:
        print('skip', rel)
        continue
    if t.startswith('#!'):
        nl = t.find('\n')
        t = t[: nl + 1] + header + t[nl + 1 :]
    else:
        t = header + t
    p.write_text(t, encoding='utf-8')
    print('patched', rel)

# even cards padding
css = ROOT / 'frontend' / 'styles.css'
s = css.read_text(encoding='utf-8')
extra = '''
/* ——— 0kg: ровные плашки ——— */
.section-card,
.card,
.activity-item,
.admin-acc,
.connect-card {
  box-sizing: border-box;
}
.section-card,
.card {
  padding: 16px;
}
.stats-grid,
.summary-grid,
.activity-meta,
.admin-acc__stats,
.persona-vars {
  width: 100%;
  max-width: 100%;
}
.btn.full,
.field-select,
.prompt-field textarea,
.prompt-field input,
.modal-field textarea,
.modal-field input {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
'''
if '0kg: ровные плашки' not in s:
    css.write_text(s + '\n' + extra, encoding='utf-8')
    print('css_even_ok')
print('done')
