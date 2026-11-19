/* LoveRussian OPS — admin control panel */
(function () {
  const state = {
    panel: 'ai',
    connect: null,
    logsTimer: null,
    logsAfterId: 0,
    lastAccounts: [],
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (typeof window.showOpsToast === 'function') window.showOpsToast(msg);
    else console.log('[ops]', msg);
  }

  function i18n() {
    const lang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ru';
    const pack = window.OPS_I18N || {};
    return pack[lang] || pack.ru || {};
  }

  async function api(method, path, body) {
    return window.ops.api(method, path, body);
  }

  function setPanel(id) {
    state.panel = id;
    document.querySelectorAll('#control-nav .control-nav__btn').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.panel === id);
    });
    document.querySelectorAll('.control-panel').forEach((panel) => {
      const on = panel.dataset.panel === id;
      panel.classList.toggle('is-on', on);
      panel.hidden = !on;
    });
    if (id === 'blacklist') loadBlacklist();
    if (id === 'proxies') loadProxies();
    if (id === 'logs') {
      startLogsLive();
      loadLogs(true);
    } else {
      stopLogsLive();
    }
    if (id === 'ai') renderAiTable(state.lastAccounts);
    if (id === 'metrics') loadMetrics();
  }

  async function loadMetrics() {
    const box = document.getElementById('metrics-console');
    if (!box) return;
    box.textContent = '…';
    try {
      const data = await api('GET', '/metrics');
      const m = data.metrics || data;
      const p = m.process || {};
      const d = m.dayMsk || {};
      const h = m.health || {};
      const cl = (m.topCliches || [])
        .map((c) => `${c.phrase}:${c.count}`)
        .join(', ');
      const stale = (m.staleAiAccounts || [])
        .slice(0, 8)
        .map((s) => `#${s.accountId} ${s.silentMin}м`)
        .join(', ');
      box.textContent = [
        `uptime ${p.uptimeMin || 0} мин · proxy ${h.proxyLen || p.proxyLen || 0} · lastReply ${h.lastReplyAgeMin != null ? h.lastReplyAgeMin + 'м назад' : '—'}`,
        `процесс: replies=${p.replies || 0} (~${m.repliesPerHour || 0}/ч) busy=${p.busyDefer || 0} heal=${p.silenceHeal || 0} dupSkip=${p.nearDupSkip || 0} textPromise=${p.textPromiseFire || 0}`,
        `сутки МСК: sent=${d.sent || 0} in=${d.incoming || 0} filtered=${d.filtered || 0} (howlong=${d.howlong || 0} silent=${d.silent || 0})`,
        cl ? `клише: ${cl}` : 'клише: —',
        stale ? `AI без ответа >30м: ${stale}` : 'AI без ответа >30м: нет',
      ].join('\n');
    } catch (e) {
      box.textContent = String(e.message || e);
    }
  }

  async function restartNotifier() {
    try {
      await api('POST', '/notifier/restart', {});
      toast('Notifier перезапущен');
      loadMetrics();
    } catch (e) {
      toast(String(e.message || e));
    }
  }

  function renderAiTable(list) {
    state.lastAccounts = Array.isArray(list) ? list : [];
    const body = document.getElementById('ctrl-ai-body');
    if (!body) return;
    const i = i18n();
    if (!state.lastAccounts.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty">${esc(i.noAccounts || '—')}</td></tr>`;
      return;
    }
    body.innerHTML = state.lastAccounts
      .map((a) => {
        const title = esc(a.name || a.phone || `#${a.id}`);
        const sub = a.name && a.phone ? `<div class="acc-sub">${esc(a.phone)}</div>` : '';
        const owner = esc(a.owner || a.ownerTg || '—');
        const ai = a.ai
          ? `<span class="pill pill--ai">${esc(i.aiOn || 'AI')}</span>`
          : `<span class="pill">${esc(i.aiOff || 'off')}</span>`;
        return `<tr data-id="${esc(a.id)}">
          <td data-label="Аккаунт"><div class="acc-name">${title}</div>${sub}</td>
          <td data-label="Владелец">${owner}</td>
          <td data-label="AI">${ai}</td>
          <td class="ctrl-actions-cell" data-label="Действия">
            <div class="ctrl-actions">
              <button class="btn btn--tiny" type="button" data-act="ai-on">${esc(i.actAiOn)}</button>
              <button class="btn btn--tiny" type="button" data-act="ai-off">${esc(i.actAiOff)}</button>
              <button class="btn btn--tiny" type="button" data-act="ping">${esc(i.actPing)}</button>
              <button class="btn btn--tiny btn--danger" type="button" data-act="del">${esc(i.actDel)}</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }

  async function loadBlacklist() {
    const body = document.getElementById('ctrl-bl-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="4" class="empty">загрузка…</td></tr>';
    try {
      const data = await api('GET', '/blacklist');
      const list = data.blacklist || [];
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty">Пусто. Никто не заблокирован.</td></tr>';
        return;
      }
      body.innerHTML = list
        .map(
          (row) => `<tr data-id="${esc(row.telegramId)}">
            <td data-label="Воркер"><div class="acc-name">${esc(row.title)}</div>${
              row.firstName ? `<div class="acc-sub">${esc(row.firstName)}</div>` : ''
            }</td>
            <td class="num" data-label="Telegram ID">${esc(row.telegramId)}</td>
            <td class="num" data-label="Аккаунты">${esc(row.accounts)}</td>
            <td data-label=""><button class="btn btn--tiny btn--danger" type="button" data-act="bl-del">${esc(i18n().actUnblock)}</button></td>
          </tr>`,
        )
        .join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="empty">${esc(err.message)}</td></tr>`;
    }
  }

  function renderProxyList(proxies, checkMap) {
    const root = document.getElementById('proxy-results');
    if (!root) return;
    const i = i18n();
    const sections = [
      {
        kind: 'work',
        list: proxies?.work || [],
        title: i.proxyWorkTitle || 'Рабочие',
        desc: i.proxyWorkDesc || 'Через них ИИ общается в Telegram',
      },
      {
        kind: 'login',
        list: proxies?.login || [],
        title: i.proxyLoginTitle || 'Резидентские',
        desc: i.proxyLoginDesc || 'Через них вход по коду и QR',
      },
    ];
    root.innerHTML = sections
      .map((sec) => {
        const head = `<h3>${esc(sec.title)} · ${sec.list.length}</h3><p class="proxy-desc">${esc(sec.desc)}</p>`;
        if (!sec.list.length) {
          return `<div class="proxy-block">${head}<p class="empty">${esc(i.proxyEmpty || 'пусто')}</p></div>`;
        }
        const rows = sec.list
          .map((p) => {
            const key = `${sec.kind}:${p.index}`;
            const chk = checkMap?.[key];
            let badge = '';
            if (chk) {
              if (chk.skipped) badge = '<span class="pill">skip</span>';
              else if (chk.ok) badge = `<span class="pill pill--on">ok ${chk.ms}ms</span>`;
              else badge = `<span class="pill pill--bad">fail</span>`;
            }
            const err = chk?.error ? `<div class="acc-sub">${esc(chk.error)}</div>` : '';
            return `<div class="proxy-row"><strong>${esc(p.label)}</strong>${badge}${err}</div>`;
          })
          .join('');
        return `<div class="proxy-block">${head}${rows}</div>`;
      })
      .join('');
  }

  let lastProxies = null;

  async function loadProxies() {
    try {
      const data = await api('GET', '/proxies');
      lastProxies = data.proxies || { work: [], login: [] };
      renderProxyList(lastProxies, null);
      const hint = document.getElementById('proxy-hint');
      const i = i18n();
      if (hint) {
        hint.textContent = typeof i.proxyHint === 'function'
          ? i.proxyHint(lastProxies.work.length, lastProxies.login.length)
          : `Рабочие ${lastProxies.work.length} · Резидентские ${lastProxies.login.length}`;
      }
    } catch (err) {
      toast(err.message);
    }
  }

  async function checkProxies() {
    const hint = document.getElementById('proxy-hint');
    const btn = document.getElementById('btn-proxy-check');
    if (hint) hint.textContent = i18n().proxyChecking || '…';
    if (btn) btn.disabled = true;
    try {
      if (!lastProxies) {
        const data = await api('GET', '/proxies');
        lastProxies = data.proxies || { work: [], login: [] };
      }
      const data = await api('POST', '/proxies/check', { pool: 'all' });
      const map = {};
      for (const r of data.results || []) {
        map[`${r.kind}:${r.index}`] = r;
      }
      renderProxyList(lastProxies, map);
      if (hint) hint.textContent = `ok ${data.ok} · fail ${data.fail} · skip ${data.skipped} → ${data.dest}`;
      toast(`ok ${data.ok} / fail ${data.fail}`);
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function formatLogLine(line) {
    let t = '—:—:—';
    try {
      t = new Date(line.ts).toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (_) {
      t = String(line.ts || '').slice(11, 19);
    }
    return `<div class="log-line log-line--${esc(line.level)}"><span class="log-ts">${esc(t)}</span> ${esc(line.text)}</div>`;
  }

  async function loadLogs(reset) {
    const box = document.getElementById('log-console');
    if (!box) return;
    try {
      const q = reset
        ? '/logs?limit=400'
        : `/logs?limit=200&afterId=${state.logsAfterId || 0}`;
      const data = await api('GET', q);
      const lines = data.lines || [];
      if (reset) {
        box.innerHTML = lines.map(formatLogLine).join('') || '<div class="empty">пусто</div>';
        box.scrollTop = box.scrollHeight;
      } else if (lines.length) {
        box.insertAdjacentHTML('beforeend', lines.map(formatLogLine).join(''));
        box.scrollTop = box.scrollHeight;
      }
      state.logsAfterId = data.latestId || state.logsAfterId;
    } catch (err) {
      if (reset) box.textContent = err.message;
    }
  }

  function startLogsLive() {
    stopLogsLive();
    state.logsTimer = setInterval(() => {
      const live = document.getElementById('logs-live');
      if (live && live.checked) loadLogs(false);
    }, 4000);
  }

  function stopLogsLive() {
    if (state.logsTimer) {
      clearInterval(state.logsTimer);
      state.logsTimer = null;
    }
  }

  function bind() {
    const nav = document.getElementById('control-nav');
    nav?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-panel]');
      if (!btn) return;
      setPanel(btn.dataset.panel);
    });

    document.getElementById('ctrl-ai-body')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      const row = e.target.closest('tr[data-id]');
      if (!btn || !row) return;
      const id = row.dataset.id;
      const act = btn.dataset.act;
      try {
        btn.disabled = true;
        if (act === 'ai-on') {
          await api('POST', `/accounts/${id}/start-ai`);
          toast('AI включён');
        } else if (act === 'ai-off') {
          await api('POST', `/accounts/${id}/stop-ai`);
          toast('AI выключен');
        } else if (act === 'ping') {
          const r = await api('GET', `/accounts/${id}/ping`);
          toast(r.online ? 'online' : 'offline');
        } else if (act === 'del') {
          const msg =
            typeof i18n().confirmDeleteAcc === 'function'
              ? i18n().confirmDeleteAcc(id)
              : `Delete #${id}?`;
          if (!confirm(msg)) return;
          await api('DELETE', `/accounts/${id}`);
          toast(i18n().actDel);
          state.lastAccounts = state.lastAccounts.filter((a) => String(a.id) !== String(id));
          renderAiTable(state.lastAccounts);
          return;
        }
        if (typeof window.refreshOps === 'function') await window.refreshOps();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('btn-ai-all-on')?.addEventListener('click', async () => {
      if (!confirm(i18n().confirmAiAllOn)) return;
      try {
        const r = await api('POST', '/accounts/bulk/start-ai', {});
        toast(`AI: ok ${r.ok}, fail ${r.fail}`);
        if (typeof window.refreshOps === 'function') await window.refreshOps();
      } catch (err) {
        toast(err.message);
      }
    });

    document.getElementById('btn-ai-all-off')?.addEventListener('click', async () => {
      if (!confirm(i18n().confirmAiAllOff)) return;
      try {
        const r = await api('POST', '/accounts/bulk/stop-ai', {});
        toast(`AI: ok ${r.ok}, fail ${r.fail}`);
        if (typeof window.refreshOps === 'function') await window.refreshOps();
      } catch (err) {
        toast(err.message);
      }
    });

    document.getElementById('btn-bl-refresh')?.addEventListener('click', () => loadBlacklist());

    document.getElementById('form-bl')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm(i18n().confirmBlAdd)) return;
      const fd = new FormData(e.target);
      try {
        const r = await api('POST', '/blacklist', {
          input: String(fd.get('input') || '').trim(),
        });
        toast(r.title || 'OK');
        e.target.reset();
        loadBlacklist();
      } catch (err) {
        toast(err.message);
      }
    });

    document.getElementById('ctrl-bl-body')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act="bl-del"]');
      const row = e.target.closest('tr[data-id]');
      if (!btn || !row) return;
      if (!confirm(i18n().confirmBlDel)) return;
      try {
        await api('DELETE', `/blacklist/${row.dataset.id}`);
        toast(i18n().actUnblock);
        loadBlacklist();
      } catch (err) {
        toast(err.message);
      }
    });

    const addStatus = document.getElementById('add-status');
    const formCode = document.getElementById('form-code');
    const form2fa = document.getElementById('form-2fa');

    document.getElementById('form-add')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const action = e.submitter?.value || 'create';
      const payload = {
        phone: String(fd.get('phone') || '').trim(),
        ownerTelegramId: String(fd.get('ownerTelegramId') || '').trim(),
        prompt: String(fd.get('prompt') || '').trim(),
      };
      try {
        if (action === 'create') {
          const r = await api('POST', '/accounts', payload);
          addStatus.textContent = `Создан #${r.account?.id} ${r.account?.phone || ''}`;
          toast('Аккаунт создан');
          if (typeof window.refreshOps === 'function') await window.refreshOps();
          return;
        }
        const r = await api('POST', '/accounts/connect/start', payload);
        state.connect = { ...payload, phone: r.phone || payload.phone };
        formCode.hidden = false;
        form2fa.hidden = true;
        addStatus.textContent = r.viaApp
          ? 'Код ушёл в приложение Telegram. Введи ниже.'
          : 'Код отправлен. Введи ниже.';
        toast('Код запрошен');
      } catch (err) {
        addStatus.textContent = err.message;
        toast(err.message);
      }
    });

    formCode?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.connect) return;
      const fd = new FormData(e.target);
      try {
        const r = await api('POST', '/accounts/connect/code', {
          ...state.connect,
          code: String(fd.get('code') || '').trim(),
        });
        if (r.status === 'needPassword') {
          form2fa.hidden = false;
          addStatus.textContent =
            'Telegram просит облачный пароль (Настройки → Конфиденциальность → Двухэтапная проверка). Если пароля нет — запроси код заново.';
          return;
        }
        formCode.hidden = true;
        form2fa.hidden = true;
        addStatus.textContent = `Подключен #${r.accountId} · ${r.online ? 'online' : 'offline'}`;
        toast('Подключен');
        if (typeof window.refreshOps === 'function') await window.refreshOps();
      } catch (err) {
        addStatus.textContent = err.message;
        toast(err.message);
      }
    });

    document.getElementById('btn-code-resend')?.addEventListener('click', async () => {
      if (!state.connect) return;
      try {
        await api('POST', '/accounts/connect/resend', state.connect);
        toast('Код запрошен снова');
      } catch (err) {
        toast(err.message);
      }
    });

    form2fa?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.connect) return;
      const fd = new FormData(e.target);
      try {
        const r = await api('POST', '/accounts/connect/password', {
          ...state.connect,
          password: String(fd.get('password') || ''),
        });
        formCode.hidden = true;
        form2fa.hidden = true;
        addStatus.textContent = `Подключен #${r.accountId} · ${r.online ? 'online' : 'offline'}`;
        toast('Подключен');
        if (typeof window.refreshOps === 'function') await window.refreshOps();
      } catch (err) {
        addStatus.textContent = err.message;
        toast(err.message);
      }
    });

    document.getElementById('btn-proxy-refresh')?.addEventListener('click', () => loadProxies());
    document.getElementById('btn-proxy-check')?.addEventListener('click', () => checkProxies());
    document.getElementById('btn-logs-refresh')?.addEventListener('click', () => loadLogs(true));
    document.getElementById('btn-metrics-refresh')?.addEventListener('click', () => loadMetrics());
    document.getElementById('btn-notifier-restart')?.addEventListener('click', () => restartNotifier());
    document.getElementById('btn-logs-clear')?.addEventListener('click', async () => {
      if (!confirm(i18n().confirmLogsClear)) return;
      try {
        await api('DELETE', '/logs');
        state.logsAfterId = 0;
        loadLogs(true);
        toast(i18n().ctrlLogsClear);
      } catch (err) {
        toast(err.message);
      }
    });
  }

  window.OpsAdmin = {
    onAccounts(list) {
      renderAiTable(list);
    },
    onTab(tab) {
      if (tab === 'control') {
        renderAiTable(state.lastAccounts);
        if (state.panel === 'logs') startLogsLive();
      } else {
        stopLogsLive();
      }
    },
    init: bind,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
