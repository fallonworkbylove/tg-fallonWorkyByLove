#!/usr/bin/env node
require('dotenv').config();
const a = require('../services/aiResponder');
console.log('detectReplyLanguage', typeof a.detectReplyLanguage);
const d = require('../services/dailyLife');
console.log('dailyLife exports', Object.keys(d).join(','));
const rp = require('../services/replyPipeline');
console.log('replyPipeline exports', Object.keys(rp).slice(0, 8).join(','));
