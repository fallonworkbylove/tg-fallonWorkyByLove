#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = path.join(__dirname, '../..');
const styles = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const ops = fs.readFileSync(path.join(root, 'ops-console/app/updates.js'), 'utf8');
const log = fs.readFileSync(path.join(root, 'CHANGELOG_TG.md'), 'utf8');

ok('tokens_m_slide', /--m-slide:\s*0\.24s/.test(styles));
ok('shell_ready_enter', /\.app-shell\.is-ready \.topbar/.test(styles));
ok('nav_indicator_css', /\.nav-indicator\s*\{/.test(styles));
ok('list_stagger', /\.tab-panel\.active\.is-anim \.accounts-cards > \.account-card/.test(styles));
ok('admin_block_anim', /\.admin-block\.is-anim/.test(styles));
ok('online_pulse', /@keyframes lr-pulse/.test(styles));
ok('html_indicator', /class="nav-indicator"/.test(html));
ok('bump_styles', /styles\.css\?v=105/.test(html));
ok('bump_app', /app\.js\?v=184/.test(html));
ok('bump_updates', /updates\.js\?v=234/.test(html));
ok('js_sync_nav', /function syncNavIndicator\(/.test(app));
ok('js_title_swap', /function bumpPageTitle\(/.test(app));
ok('js_shell_ready', /classList\.add\('is-ready'\)/.test(app));
ok('js_admin_anim', /panel\.classList\.add\('is-anim'\)/.test(app));
ok('changelog_0lc', /## 0lc\./.test(log));
ok('feed_title', /Анимации по всему приложению/.test(updates));
ok('ops_feed_title', /Анимации по всему приложению/.test(ops));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
