require('dotenv').config({ quiet: true });
require('../services/opsLiveMetrics')
  .getLiveMetrics()
  .then((m) => {
    console.log(
      JSON.stringify(
        {
          repliesPerHour: m.repliesPerHour,
          staleAi: m.staleAiAccounts,
          lastReplyAgeMin: m.health?.lastReplyAgeMin,
          source: m.health?.source,
        },
        null,
        2,
      ),
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
