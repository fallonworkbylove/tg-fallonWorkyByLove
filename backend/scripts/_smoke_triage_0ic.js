#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const so = require('../services/scaleOps');
const i12 = require('../services/humanIdeas12');
const fs = require('fs');
const path = require('path');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
}

// 1 permanence ≠ timing
{
  const ask = 'Ты с концами переезжаешь да ?';
  assert(so.isPermanenceMoveAsk(ask), 'permanence detect');
  const bad = so.fixOfftopicMoveReply('через пару недель уеду)', ask);
  assert(!/пару\s+недел/i.test(bad), `permanence not timing → ${bad}`);
  assert(/(?:к\s+маме|совсем|окончательно)/i.test(bad), `permanence yes → ${bad}`);
  const keep = so.fixOfftopicMoveReply('ну да, к маме)', ask);
  assert(/к\s+маме/i.test(keep), 'keep good permanence');
}

// 2 when-ask still timing
{
  const when = so.fixOfftopicMoveReply('сериал смотрю)', 'когда переезжаешь?');
  assert(/пару\s+недел|скоро/i.test(when), `when-ask → ${when}`);
}

// 3 где живёшь ≠ status pool
{
  assert(!i12.isStatusAsk('А ты где живешь?'), 'где живешь not status');
  assert(!i12.isStatusAsk('А город какой'), 'город not status');
  assert(i12.isStatusAsk('что делаешь?'), 'что делаешь is status');
  const geo = i12.rotateStatusAskReply('просто дома)', 'А ты где живешь?', 1, 'p');
  assert(geo === 'просто дома)', 'rotate keeps geo reply');
}

// 4 wiring
{
  const soft = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
  assert(/fixOfftopicMoveReply/.test(soft), 'soft hooks move');
  const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
  assert(/reengageInFlight/.test(pipe) && /isNearDupOutbound/.test(pipe), 'pipe anti-dup');
  const sil = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
  assert(/reengageInFlight/.test(sil), 'silence skips reengage inflight');
}

console.log('SMOKE_TRIAGE_0IC_OK');
