require('dotenv').config();
const t = require('../services/timing');
console.log('now_utc', new Date().toISOString());
console.log('WORK_TIMEZONE', process.env.WORK_TIMEZONE || 'Europe/Moscow(default)');
console.log('hour', t.getWorkZoneHour());
console.log('voiceQuiet', t.isVoiceQuietHour());
console.log('globalWork', t.isWithinGlobalWorkingHours());
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: process.env.WORK_TIMEZONE || 'Europe/Moscow',
  hour: 'numeric',
  hour12: false,
}).formatToParts(new Date());
console.log('parts', JSON.stringify(parts));
const hour24 = new Intl.DateTimeFormat('en-GB', {
  timeZone: process.env.WORK_TIMEZONE || 'Europe/Moscow',
  hour: '2-digit',
  hour12: false,
}).format(new Date());
console.log('enGB_hour', hour24);
