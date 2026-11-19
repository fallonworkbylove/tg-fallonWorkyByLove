#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const text = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
const start = text.indexOf('async function fireReengage');
const end = text.indexOf('\nasync function ', start + 10);
const chunk = text.slice(start, end > 0 ? end : start + 50000);
const lines = chunk.split(/\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!/\bvoice\b/.test(line)) continue;
  if (/voiceFileName|nft_voice|voiceTag|ReferenceError|voice-файл|SendMessageRecordAudio|sendVoiceReply|VOICES_DIR|NFT_VOICE/.test(line)) {
    continue;
  }
  console.log(`${i + 1}: ${line}`);
}
console.log('SCAN_DONE lines=', lines.length);
