require('dotenv').config({ quiet: true });

(async () => {
  const live = await require('../services/opsLiveMetrics').getLiveMetrics();
  const snap = await require('../services/adminConsoleStats').getConsoleSnapshot();
  const b = snap.funnelBoard || {};
  const a = snap.accounts || {};
  const day = snap.messages?.day || {};
  console.log(
    JSON.stringify(
      {
        accounts: { total: a.total, online: a.online, aiOn: a.aiOn },
        hotLeads: snap.hotLeads,
        day: { sent: day.sent, incoming: day.incoming },
        radar: {
          repliesPerHour: snap.radar?.repliesPerHour,
          staleAi: snap.radar?.staleAi,
        },
        board: b,
        proxy: {
          work_alive: snap.proxyHealth?.work_alive,
          proxy_len: snap.proxyHealth?.proxy_len ?? snap.proxyHealth?.work,
        },
        costToday: snap.cost?.today || null,
        nftRaw: live.nftFunnel,
        health: live.health,
      },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
