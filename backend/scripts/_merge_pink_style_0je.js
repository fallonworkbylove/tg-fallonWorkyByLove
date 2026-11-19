#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const pinkPath = path.join(root, 'frontend/styles_pink_base.css');
const outPath = path.join(root, 'frontend/styles.css');

let css = fs.readFileSync(pinkPath, 'utf8');

css = css.replace(
  /\.brand-mark \{[\s\S]*?\n\}/,
  `.brand-mark {
  font-family: var(--display);
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0 0 4px;
  line-height: 1.1;
  background: linear-gradient(105deg, #fdf2f8 0%, #f0abfc 42%, var(--primary) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}`,
);

css = css.replace(/\.content \{([^}]*)\}/, (m, body) => {
  if (/overflow-x:\s*hidden/.test(body)) return m;
  if (!/min-width:\s*0/.test(body)) {
    body = body.replace(/min-height:\s*0;/, 'min-height: 0;\n  min-width: 0;\n  max-width: 100%;');
  }
  if (!/overflow-x:\s*hidden/.test(body)) {
    body = body.replace(
      /overflow-y:\s*auto;/,
      'overflow-x: hidden;\n  overflow-y: auto;',
    );
  }
  return `.content {${body}}`;
});

css = css.replace(
  /\.account-card \{[\s\S]*?\n\}/,
  `.account-card {
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  padding: 12px;
  background: var(--card, rgba(26, 16, 32, 0.94));
  color: #f8f0f6;
  -webkit-text-fill-color: #f8f0f6;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s var(--ease-out);
  min-width: 0;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

label.account-card,
.account-card.account-card--select-all {
  color: #f8f0f6;
  -webkit-text-fill-color: #f8f0f6;
}`,
);

css = css.replace(
  /\.account-card--select-all \{[\s\S]*?\n\}/,
  `.account-card--select-all {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(11, 13, 16, 0.55);
}`,
);

css = css.replace(
  /\.account-card__phone \{[\s\S]*?\n\}/,
  `.account-card__phone {
  font-weight: 700;
  font-size: 1rem;
  line-height: 1.35;
  color: #f8f0f6 !important;
  -webkit-text-fill-color: #f8f0f6 !important;
  opacity: 1 !important;
  visibility: visible !important;
  overflow: visible;
  white-space: normal;
  word-break: break-word;
  min-width: 0;
  flex: 1 1 auto;
}`,
);

css = css.replace(
  /\.account-card__sub \{[\s\S]*?\n\}/,
  `.account-card__sub {
  color: #c4a8c0 !important;
  -webkit-text-fill-color: #c4a8c0 !important;
  font-size: 0.78rem;
  font-weight: 500;
  overflow: visible;
  white-space: normal;
  margin-top: -2px;
}`,
);

css = css.replace(
  /\.account-card__meta \{[\s\S]*?\n\}/,
  `.account-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  color: #c4a8c0 !important;
  -webkit-text-fill-color: #c4a8c0 !important;
  font-size: 0.8rem;
  min-width: 0;
  max-width: 100%;
}`,
);

fs.writeFileSync(outPath, css);
const ok =
  css.includes('--primary: #e879c8') &&
  css.includes('#f8f0f6 !important') &&
  css.includes('fdf2f8');
console.log(ok ? 'MERGE_OK' : 'MERGE_FAIL', 'bytes', Buffer.byteLength(css));
process.exit(ok ? 0 : 1);
