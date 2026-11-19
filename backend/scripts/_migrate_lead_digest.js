#!/usr/bin/env node
require('dotenv').config();
const lead = require('../services/leadScoring');
lead
  .ensureSchema()
  .then(() => {
    console.log('schema_ok', lead.FUNNEL_STAGES.join(','));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
