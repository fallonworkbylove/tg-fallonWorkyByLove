#!/usr/bin/env node
'use strict';
/**
 * 0mk: Whisper filename by magic (ogg/webm/mp4) — no API call.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const ai = require('../services/aiResponder');
check('export detectAudioFilename', typeof ai.detectAudioFilename === 'function');

const ogg = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
check('ogg magic', ai.detectAudioFilename(ogg, 'video.mp4') === 'voice.ogg');

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
check('webm magic', ai.detectAudioFilename(webm, 'video.mp4') === 'voice.webm');

const mp4 = Buffer.alloc(16, 0);
mp4[4] = 0x66;
mp4[5] = 0x74;
mp4[6] = 0x79;
mp4[7] = 0x70;
check('mp4 ftyp', ai.detectAudioFilename(mp4, 'voice.ogg') === 'voice.mp4');

const tiny = Buffer.from([1, 2, 3]);
check('tiny keeps hint', ai.detectAudioFilename(tiny, 'voice.ogg') === 'voice.ogg');

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('transcribe uses detect', /detectAudioFilename\(buffer/.test(src));
check('rate-limit err log', /_transcribeErrAt/.test(src));

if (fails) {
  console.error('SMOKE_0mk_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mk_OK');
process.exit(0);
