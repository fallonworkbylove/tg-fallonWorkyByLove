#!/usr/bin/env node
/**
 * Куратор bot_patterns по правилам «живого» промпта.
 *
 * НЕ пинит все 14k — в промпт всё равно уходят только ~8 лучших.
 * Делает:
 *  1) поднимает uses до 2 у коротких удачных фраз (rate>=0.5) → пул «отобранных»
 *  2) пинит топ-N якорей (хорошие)
 *  3) пинит meet/эссе как pinned_bad
 *
 *   node scripts/curate-patterns.js
 *   node scripts/curate-patterns.js --dry-run
 *   node scripts/curate-patterns.js --promote=3000 --pin-good=120 --pin-bad=80
 */
require('dotenv').config();
const db = require('../db');

function parseArgs() {
  const args = { dryRun: false, promote: 4000, pinGood: 120, pinBad: 80 };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) {
      if (m[1] === 'promote') args.promote = Number(m[2]);
      if (m[1] === 'pin-good') args.pinGood = Number(m[2]);
      if (m[1] === 'pin-bad') args.pinBad = Number(m[2]);
    }
  }
  return args;
}

const MEET_RE =
  /(скоро\s+)?увидимся|встретимся|погуляем|жду\s+тебя\s+тоже|когда\s+я\s+приеду|обязательно\s+увид|давай\s+встрети|где\s+планируешь\s+встрет/i;
const ESSAY_RE =
  /действительно\s+может|всегда\s+помогает|важно\s+помнить|в\s+итоге|кроме\s+того|уверенность\s+всегда|музыка\s+действительно/i;

function isHumanGood(reply) {
  const t = String(reply || '').trim();
  if (!t || t.length < 2 || t.length > 140) return false;
  if (/\n/.test(t)) return false;
  if (MEET_RE.test(t) || ESSAY_RE.test(t)) return false;
  if (t.split(/[.!?]+/).filter((s) => s.trim()).length > 3) return false;
  return true;
}

function isBadExample(reply) {
  const t = String(reply || '').trim();
  if (!t) return false;
  if (MEET_RE.test(t)) return true;
  if (ESSAY_RE.test(t) && t.length > 80) return true;
  if (t.length > 220) return true;
  if (/\n/.test(t) && t.length > 60) return true;
  return false;
}

function scoreGood(row) {
  const t = String(row.bot_reply || '');
  let s = Number(row.success_rate) || 0;
  s += Math.min(Number(row.uses) || 0, 5) * 0.02;
  // Короткие живые — выше
  if (t.length <= 60) s += 0.15;
  else if (t.length <= 100) s += 0.08;
  if (/\)/.test(t)) s += 0.05;
  if (/^[а-яa-z]/.test(t)) s += 0.03; // lowercase start
  return s;
}

async function main() {
  const args = parseArgs();
  console.log('[curate]', args);

  const [rows] = await db.execute(
    `SELECT id, bot_reply, uses, success_rate, pinned, pinned_bad, stage
     FROM bot_patterns`,
  );

  const goodCandidates = rows
    .filter((r) => Number(r.success_rate) >= 0.5 && isHumanGood(r.bot_reply))
    .map((r) => ({ ...r, score: scoreGood(r) }))
    .sort((a, b) => b.score - a.score);

  const badCandidates = rows
    .filter((r) => isBadExample(r.bot_reply))
    .sort((a, b) => Number(b.success_rate) - Number(a.success_rate));

  const toPromote = goodCandidates.slice(0, args.promote);
  const toPinGood = goodCandidates.slice(0, args.pinGood);
  const toPinBad = badCandidates.slice(0, args.pinBad);

  console.log('human-good pool', goodCandidates.length);
  console.log('promote uses>=2', toPromote.length);
  console.log('pin good', toPinGood.length);
  console.log('pin bad', toPinBad.length);
  console.log('sample good:', toPinGood.slice(0, 5).map((r) => r.bot_reply));
  console.log('sample bad:', toPinBad.slice(0, 5).map((r) => r.bot_reply));

  if (args.dryRun) {
    console.log('[curate] dry-run — БД не трогаю');
    process.exit(0);
  }

  // 1) Поднять uses, чтобы проходили порог «отобранных»
  for (let i = 0; i < toPromote.length; i += 200) {
    const chunk = toPromote.slice(i, i + 200);
    const ids = chunk.map((r) => r.id);
    await db.execute(
      `UPDATE bot_patterns SET uses = GREATEST(uses, 2) WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  // 2) Pin good anchors
  for (let i = 0; i < toPinGood.length; i += 200) {
    const chunk = toPinGood.slice(i, i + 200);
    const ids = chunk.map((r) => r.id);
    await db.execute(
      `UPDATE bot_patterns
       SET pinned = 1, pinned_bad = 0, uses = GREATEST(uses, 2),
           success_rate = GREATEST(success_rate, 0.7)
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  // 3) Pin bad (meet/essay)
  for (let i = 0; i < toPinBad.length; i += 200) {
    const chunk = toPinBad.slice(i, i + 200);
    const ids = chunk.map((r) => r.id);
    await db.execute(
      `UPDATE bot_patterns
       SET pinned = 1, pinned_bad = 1, uses = GREATEST(uses, 2), success_rate = 0
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  const [[g]] = await db.execute(
    'SELECT COUNT(*) AS n FROM bot_patterns WHERE uses>=2 AND success_rate>=0.5',
  );
  const [[pg]] = await db.execute(
    'SELECT COUNT(*) AS n FROM bot_patterns WHERE pinned=1 AND pinned_bad=0',
  );
  const [[pb]] = await db.execute(
    'SELECT COUNT(*) AS n FROM bot_patterns WHERE pinned=1 AND pinned_bad=1',
  );
  console.log('[curate] done', { eligible_good_pool: g.n, pinned_good: pg.n, pinned_bad: pb.n });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
