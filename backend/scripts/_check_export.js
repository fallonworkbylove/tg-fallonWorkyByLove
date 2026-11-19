require('dotenv').config({ quiet: true });
const m = require('../services/mediaSend');
console.log('mediaSend', typeof m.isContradictoryMediaText, typeof m.stripContradictoryMediaParts);
const rp = require('../services/replyPipeline');
console.log('replyPipeline_loaded', typeof rp.processBufferedMessages || Object.keys(rp).slice(0, 5));
