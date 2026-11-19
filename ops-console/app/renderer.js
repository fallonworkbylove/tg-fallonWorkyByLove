/* LoveRussian OPS renderer */

const STAGE_ORDER = ['day1', 'day2', 'day3', 'day4'];
const THEME_IDS = (window.OPS_THEMES || []).map((t) => t.id);
const THEME_KEY = 'lr-ops-theme';
const LANG_KEY = 'lr-ops-lang';
const TAB_KEY = 'lr-ops-tab';

let state = {
  tab: 'funnel',
  filter: 'all',
  theme: 'rose',
  lang: 'ru',
  data: null,
  refreshSec: 25,
  timer: null,
  openAccountId: null,
  dense: localStorage.getItem('lr-ops-dense') === '1',
  focusCard: 0,
};

const el = {
  stats: document.getElementById('stats'),
  board: document.getElementById('board'),
  meta: document.getElementById('meta-line'),
  hint: document.getElementById('board-hint'),
  toast: document.getElementById('toast'),
  refresh: document.getElementById('btn-refresh'),
  dense: document.getElementById('btn-dense'),
  csv: document.getElementById('btn-csv'),
  filters: document.getElementById('filters'),
  tabs: document.getElementById('tabs'),
  themeGrid: document.getElementById('theme-grid'),
  langGrid: document.getElementById('lang-grid'),
  accountsBody: document.getElementById('accounts-body'),
  accountsHint: document.getElementById('accounts-hint'),
  drawer: document.getElementById('account-drawer'),
  drawerTitle: document.getElementById('acc-drawer-title'),
  drawerBody: document.getElementById('acc-drawer-body'),
  brandSub: document.querySelector('.brand-sub'),
  updatesList: document.getElementById('updates-list'),
  activityList: document.getElementById('activity-list'),
  activityFilters: document.getElementById('activity-filters'),
  activityRefresh: document.getElementById('btn-activity-refresh'),
  activityLive: document.getElementById('activity-live'),
  accessForm: document.getElementById('form-access'),
  accessToken: document.getElementById('access-token'),
  accessStatus: document.getElementById('access-status'),
  accessBanner: document.getElementById('access-banner'),
};

const activityState = {
  kindGroup: 'all',
  afterId: 0,
  items: [],
  timer: null,
};

function t() {
  const pack = window.OPS_I18N || {};
  return pack[state.lang] || pack.ru || {};
}

function n(v) {
  const num = Math.round(Number(v) || 0);
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function delayLabel(min, max) {
  const i = t().drawer || {};
  const a = min != null ? Number(min) : null;
  const b = max != null ? Number(max) : null;
  if (a == null && b == null) return i.delayDefault || '—';
  if (a != null && b != null && a === b) return `${a} ${i.sec || 'sec'}`;
  if (a != null && b != null) return `${a}–${b} ${i.sec || 'sec'}`;
  return `${a ?? b} ${i.sec || 'sec'}`;
}

function displayName(account) {
  const name = String(account?.name || '').trim();
  const phone = String(account?.phone || '').trim();
  if (name && phone) return { title: name, sub: phone };
  if (phone) return { title: phone, sub: name || null };
  if (name) return { title: name, sub: null };
  return { title: `#${account?.id ?? '?'}`, sub: null };
}

function leadTitle(c) {
  const u = String(c?.peer_username || '').trim().replace(/^@+/, '');
  if (u && !/^\d+$/.test(u)) return `@${u}`;
  const id = String(c?.peer_id || '').trim();
  if (id) return id.length > 12 ? `id …${id.slice(-6)}` : `id ${id}`;
  return t().lead || 'lead';
}

function safeTelegramHref(raw) {
  const s = String(raw ?? '').trim();
  if (/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/[^\s<>"']+$/i.test(s)) return s;
  if (/^@[A-Za-z0-9_]{3,64}$/.test(s)) return `https://t.me/${s.slice(1)}`;
  if (/^\+[A-Za-z0-9_-]{3,128}$/.test(s)) return `https://t.me/${s}`;
  return '';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function agoLabel(iso) {
  const i = t();
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return i.agoNow;
  const m = Math.floor(ms / 60000);
  if (m < 1) return i.agoNow;
  if (m < 60) return i.agoM(m);
  const h = Math.floor(m / 60);
  if (h < 48) return i.agoH(h);
  return i.agoD(Math.floor(h / 24));
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.toast.hidden = true;
  }, 2800);
}
window.showOpsToast = showToast;

function renderThemeGrid() {
  if (!el.themeGrid) return;
  const themes = window.OPS_THEMES || [];
  const i = t();
  const labels = i.themes || {};
  const groups = [
    { id: 'dark', title: i.themeDark || 'Тёмные' },
    { id: 'light', title: i.themeLight || 'Светлые' },
  ];
  const card = (th) => {
    const [name, desc] = labels[th.id] || [th.id, ''];
    const on = th.id === state.theme ? ' is-on' : '';
    return `<button class="theme-card${on}" data-theme="${th.id}" type="button">
      <span class="theme-preview theme-preview--${th.preview || th.id}"></span>
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(desc)}</span>
    </button>`;
  };
  el.themeGrid.innerHTML = groups
    .map((g) => {
      const list = themes.filter((th) => (th.group || 'dark') === g.id);
      if (!list.length) return '';
      return `<div class="theme-group">
        <p class="theme-group__title">${escapeHtml(g.title)}</p>
        <div class="theme-group__grid">${list.map(card).join('')}</div>
      </div>`;
    })
    .join('');
}

function syncLangCards() {
  if (!el.langGrid) return;
  el.langGrid.querySelectorAll('.lang-card').forEach((card) => {
    card.classList.toggle('is-on', card.dataset.lang === state.lang);
  });
}

function applyStaticLabels() {
  const i = t();
  document.documentElement.setAttribute('lang', state.lang);
  if (el.brandSub) el.brandSub.textContent = i.brandSub;
  const tabMap = {
    funnel: i.tabFunnel,
    accounts: i.tabAccounts,
    control: i.tabControl,
    activity: i.tabActivity,
    updates: i.tabUpdates,
    settings: i.tabSettings,
  };
  el.tabs.querySelectorAll('.tab').forEach((btn) => {
    if (tabMap[btn.dataset.tab]) btn.textContent = tabMap[btn.dataset.tab];
  });
  el.refresh.textContent = i.refresh;
  const filterMap = {
    all: i.filterAll,
    waiting: i.filterWaiting,
    ai: i.filterAi,
    operator: i.filterOp,
  };
  el.filters.querySelectorAll('.chip').forEach((btn) => {
    if (filterMap[btn.dataset.filter]) btn.textContent = filterMap[btn.dataset.filter];
  });
  const accTitle = document.querySelector('#view-accounts .panel-card__head h2');
  if (accTitle) accTitle.textContent = i.accountsTitle;
  const ths = document.querySelectorAll('.accounts-table thead th');
  const thLabels = [i.thName, i.thOwner, i.thStatus, i.thAi, i.thToday, i.thWeek];
  ths.forEach((th, idx) => {
    if (thLabels[idx]) th.textContent = thLabels[idx];
  });
  const kicker = document.querySelector('.acc-drawer__kicker');
  if (kicker) kicker.textContent = i.drawerKicker;
  const closeBtn = document.querySelector('.acc-drawer__head .btn');
  if (closeBtn) closeBtn.textContent = i.close;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (i[key] != null) node.textContent = i[key];
  });
  if (el.activityFilters) {
    const aMap = {
      all: i.activityFilterAll,
      media: i.activityFilterMedia,
      nft: i.activityFilterNft,
      lead: i.activityFilterLead,
    };
    el.activityFilters.querySelectorAll('[data-akind]').forEach((btn) => {
      if (aMap[btn.dataset.akind]) btn.textContent = aMap[btn.dataset.akind];
    });
  }
  renderThemeGrid();
  syncLangCards();
  if (state.tab === 'activity') renderActivityList();
}

function applyTheme(theme) {
  const tId = THEME_IDS.includes(theme) ? theme : 'rose';
  state.theme = tId;
  document.documentElement.setAttribute('data-theme', tId);
  try {
    localStorage.setItem(THEME_KEY, tId);
  } catch (_) {}
  if (el.themeGrid) {
    el.themeGrid.querySelectorAll('.theme-card').forEach((card) => {
      card.classList.toggle('is-on', card.dataset.theme === tId);
    });
  }
  if (window.ops?.setThemeChrome) {
    window.ops.setThemeChrome(tId).catch(() => {});
  }
}

function applyLang(lang, { toast } = {}) {
  const next = lang === 'en' ? 'en' : 'ru';
  state.lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch (_) {}
  applyStaticLabels();
  renderUpdates();
  if (state.data) renderAll(state.data);
  else if (el.meta && !el.meta.textContent) el.meta.textContent = t().loading;
  if (state.openAccountId && state.data) {
    const list = state.data.accounts?.list || [];
    const account = list.find((a) => String(a.id) === String(state.openAccountId));
    if (account) openAccountDrawer(account, { keepOpen: true });
  }
  if (toast) showToast(t().langSaved);
}

function setTab(tab) {
  const next = ['funnel', 'accounts', 'control', 'activity', 'updates', 'settings'].includes(tab)
    ? tab
    : 'funnel';
  state.tab = next;
  try {
    localStorage.setItem(TAB_KEY, next);
  } catch (_) {}

  if (next !== 'accounts') closeAccountDrawer();

  document.querySelectorAll('.view').forEach((view) => {
    const on = view.dataset.view === next;
    view.classList.toggle('is-on', on);
    view.hidden = !on;
  });
  el.tabs.querySelectorAll('.tab').forEach((btn) => {
    const on = btn.dataset.tab === next;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (next === 'updates') refreshUpdatesFromServer();
  if (next === 'activity') {
    loadActivity(true);
    startActivityLive();
  } else {
    stopActivityLive();
  }
  if (next === 'funnel' && !state.data && el.board && !el.board.children.length) {
    renderEmptyBoard(t().noTokenShort);
  }
  if (window.OpsAdmin?.onTab) window.OpsAdmin.onTab(next);
}

function activityKindLabel(kind) {
  const i = t();
  if (kind === 'media_miss' || kind === 'media_sent') return i.activityFilterMedia || 'media';
  if (kind === 'nft_voice') return i.activityFilterNft || 'nft';
  if (kind === 'lead_ready' || kind === 'help_agreed') return i.activityFilterLead || 'lead';
  return kind;
}

function activityMatchesFilter(kind, group) {
  if (!group || group === 'all') return true;
  if (group === 'media') return kind === 'media_miss' || kind === 'media_sent';
  if (group === 'nft') return kind === 'nft_voice';
  if (group === 'lead') return kind === 'lead_ready' || kind === 'help_agreed';
  return true;
}

function formatActivityTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return String(iso);
  }
}

function renderActivityList() {
  if (!el.activityList) return;
  const i = t();
  const items = activityState.items.filter((e) =>
    activityMatchesFilter(e.kind, activityState.kindGroup),
  );
  if (!items.length) {
    el.activityList.innerHTML = `<div class="empty-state"><p>${escapeHtml(
      i.activityEmpty || 'Пока пусто.',
    )}</p></div>`;
    return;
  }
  el.activityList.innerHTML = items
    .map((e) => {
      const kind = escapeHtml(e.kind || '');
      const title = escapeHtml(e.title || '');
      const body = escapeHtml(e.body || '');
      const time = escapeHtml(formatActivityTime(e.createdAt));
      const kLabel = escapeHtml(activityKindLabel(e.kind));
      return `<article class="activity-item activity-item--${kind}">
        <p class="activity-kind">${kLabel}</p>
        <div class="activity-item__head">
          <h3 class="activity-item__title">${title}</h3>
          <span class="activity-item__time">${time}</span>
        </div>
        ${body ? `<pre class="activity-item__body">${body}</pre>` : ''}
      </article>`;
    })
    .join('');
}

async function loadActivity(reset) {
  if (!window.ops?.api) return;
  try {
    if (reset) {
      activityState.afterId = 0;
      activityState.items = [];
    }
    const q = reset
      ? '/activity?limit=100'
      : `/activity?limit=50&afterId=${activityState.afterId || 0}`;
    const data = await window.ops.api('GET', q);
    const events = Array.isArray(data?.events) ? data.events : [];
    if (reset) {
      activityState.items = events;
    } else if (events.length) {
      const seen = new Set(activityState.items.map((e) => e.id));
      const fresh = events.filter((e) => !seen.has(e.id));
      if (fresh.length) {
        activityState.items = [...fresh.reverse(), ...activityState.items].slice(0, 200);
      }
    }
    if (data?.latestId) activityState.afterId = Number(data.latestId) || activityState.afterId;
    else if (activityState.items.length) {
      activityState.afterId = Math.max(...activityState.items.map((e) => Number(e.id) || 0));
    }
    renderActivityList();
  } catch (err) {
    if (reset && el.activityList) {
      el.activityList.innerHTML = `<div class="empty-state"><p>${escapeHtml(
        err?.message || 'Ошибка загрузки',
      )}</p></div>`;
    }
  }
}

function startActivityLive() {
  stopActivityLive();
  activityState.timer = setInterval(() => {
    if (state.tab !== 'activity') return;
    if (el.activityLive && !el.activityLive.checked) return;
    loadActivity(false);
  }, 8000);
}

function stopActivityLive() {
  if (activityState.timer) {
    clearInterval(activityState.timer);
    activityState.timer = null;
  }
}

function bundledUpdates() {
  if (Array.isArray(window.OPS_UPDATES) && window.OPS_UPDATES.length) {
    return window.OPS_UPDATES;
  }
  if (Array.isArray(window.LOVERUSSIAN_UPDATES) && window.LOVERUSSIAN_UPDATES.length) {
    return window.LOVERUSSIAN_UPDATES;
  }
  return [];
}

function renderUpdates() {
  if (!el.updatesList) return;
  const i = t();
  const entries = bundledUpdates();
  if (!entries.length) {
    el.updatesList.innerHTML = `<div class="empty-state"><p>${escapeHtml(
      i.updatesEmpty || 'Обновлений пока нет.'
    )}</p></div>`;
    return;
  }
  el.updatesList.innerHTML = entries
    .map((entry) => {
      const date = escapeHtml(entry.date || '');
      const tag = entry.tag ? escapeHtml(String(entry.tag)) : '';
      const title = escapeHtml(entry.title || '');
      const lead = escapeHtml(entry.lead || '');
      const items = Array.isArray(entry.items) ? entry.items : [];
      const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const isSmall = String(entry.tag || '')
        .toUpperCase()
        .includes('МАЛЕН');
      return `
        <article class="update-block${isSmall ? ' update-block--small' : ''}">
          <p class="update-block__date">${date}${
            tag ? ` <span class="update-block__date-tag">· ${tag}</span>` : ''
          }</p>
          <h2 class="update-block__title">${title}</h2>
          ${lead ? `<p class="update-block__lead">${lead}</p>` : ''}
          ${list ? `<ul class="update-block__list">${list}</ul>` : ''}
        </article>
      `;
    })
    .join('');
}

/** Подтянуть ленту с сервера (как в миниаппе), иначе остаётся вшитая. */
async function refreshUpdatesFromServer() {
  if (!window.ops?.fetchUpdates) {
    renderUpdates();
    return;
  }
  try {
    const list = await window.ops.fetchUpdates();
    if (Array.isArray(list) && list.length) {
      window.OPS_UPDATES = list;
      window.LOVERUSSIAN_UPDATES = list;
    }
  } catch (err) {
    console.warn('[ops] updates remote:', err?.message || err);
  }
  renderUpdates();
}

function renderStats(data) {
  const i = t();
  const m = data.messages || {};
  const day = m.day || {};
  const week = m.week || {};
  const month = m.month || {};
  const acc = data.accounts || {};
  const funnel = data.funnel?.funnel || {};
  const convLen = Array.isArray(funnel.conversations) ? funnel.conversations.length : 0;
  const stageSum = STAGE_ORDER.reduce((s, k) => s + Number(funnel[k] || 0), 0);
  const leadsLive = convLen || stageSum;
  el.stats.innerHTML = `
    <article class="stat stat--hero">
      <strong>${n(day.sent)}</strong>
      <span>${i.sentToday}</span>
      <em>${i.incoming} ${n(day.incoming)} · ${i.chats} ${n(day.chats)}</em>
    </article>
    <article class="stat">
      <strong>${n(week.sent)}</strong>
      <span>${i.last7}</span>
      <em>${i.incoming} ${n(week.incoming)}</em>
    </article>
    <article class="stat">
      <strong>${n(month.sent)}</strong>
      <span>${i.last30}</span>
      <em>${i.incoming} ${n(month.incoming)}</em>
    </article>
    <article class="stat">
      <strong>${n(acc.online)}<small>/${n(acc.total)}</small></strong>
      <span>${i.onlineLabel}</span>
      <em>${i.aiOf} ${n(acc.aiOn)} ${i.of} ${n(acc.total)}</em>
    </article>
    <article class="stat">
      <strong>${n(leadsLive || data.hotLeads)}</strong>
      <span>${i.leadsBoard}</span>
      <em>${i.hot} ${n(data.hotLeads || 0)}</em>
    </article>
    <article class="stat">
      <strong>${n(day.reactions || 0)}</strong>
      <span>${i.reactionsToday}</span>
      <em>${i.fromSent}</em>
    </article>
    <article class="stat">
      <strong>${n((data.funnelBoard || {}).voice7d || (data.funnelBoard || {}).campaignArchive?.voice7d || 0)}</strong>
      <span>${i.nftArchive || 'NFT архив'}</span>
      <em>ГС 7д · stuck ${n((data.funnelBoard || {}).stuckWorkNoVoice || (data.funnelBoard || {}).campaignArchive?.stuck || 0)}</em>
    </article>
  `;
}

function filteredLeads(data) {
  const funnel = data.funnel || {};
  let list = Array.isArray(funnel.conversations) ? funnel.conversations.slice() : [];
  if (state.filter === 'waiting') list = list.filter((c) => c.waiting);
  if (state.filter === 'ai') list = list.filter((c) => c.handled_by === 'ai');
  if (state.filter === 'operator') list = list.filter((c) => c.handled_by === 'operator');
  return list;
}

function stageLabels(funnel) {
  const i = t();
  // Always prefer UI language; API labels are RU-only and must not override EN.
  return { ...(funnel.labels || {}), ...i.stage };
}

function renderEmptyBoard(msg) {
  const i = t();
  const labels = stageLabels({});
  const note = msg || i.noTokenShort || i.emptyCol;
  el.board.innerHTML = STAGE_ORDER.map(
    (stage) => `
        <section class="col">
          <header class="col-head">
            <h2>${escapeHtml(labels[stage] || stage)}</h2>
            <span class="col-count">0</span>
          </header>
          <div class="col-body"><p class="empty">${escapeHtml(note)}</p></div>
        </section>`,
  ).join('');
  if (el.hint) el.hint.textContent = note;
}

function renderBoard(data) {
  const i = t();
  const funnel = data.funnel || {};
  const labels = stageLabels(funnel);
  const stages = Array.isArray(funnel.stages) && funnel.stages.length ? funnel.stages : STAGE_ORDER;
  const list = filteredLeads(data);
  const byStage = Object.fromEntries(stages.map((s) => [s, []]));
  for (const c of list) {
    // Отсев не колонка — только дни кампании.
    if (c.funnel_stage === 'filtered') continue;
    const s = byStage[c.funnel_stage] ? c.funnel_stage : 'day1';
    byStage[s].push(c);
  }

  el.board.innerHTML = stages
    .map((stage) => {
      const cards = byStage[stage] || [];
      const body = cards.length
        ? cards
            .map((c) => {
              const name = escapeHtml(leadTitle(c));
              const snip = escapeHtml(c.snippet || i.noText);
              const who =
                c.handled_by === 'operator'
                  ? `<span class="tag tag--op">${i.tagOp}</span>`
                  : `<span class="tag tag--ai">${i.tagAi}</span>`;
              const wait = c.waiting ? `<span class="tag tag--wait">${i.tagWait}</span>` : '';
              const via = escapeHtml(c.worker || c.account_phone || '—');
              const ageH = Number(c.age_hours);
              const dayCap =
                stage === 'day1' ? 24 : stage === 'day2' ? 48 : stage === 'day3' ? 72 : 96;
              const pct = Number.isFinite(ageH)
                ? Math.max(4, Math.min(100, Math.round((ageH / dayCap) * 100)))
                : 8;
              const dayHint = Number.isFinite(ageH)
                ? `${Math.floor(ageH)}ч · ${labels[stage] || stage}`
                : labels[stage] || stage;
              const pctBucket = Math.max(1, Math.min(10, Math.round(pct / 10)));
              return `
              <article class="card" tabindex="0" data-account="${escapeHtml(String(c.account_id || ''))}" data-peer="${escapeHtml(String(c.peer_id || ''))}">
                <div class="card-top">
                  <div class="card-name">${name}</div>
                  <span class="card-time">${agoLabel(c.last_user_at || c.last_at)}</span>
                </div>
                <div class="day-bar" title="${escapeHtml(dayHint)}"><i class="day-bar__fill day-bar__fill--${pctBucket}"></i></div>
                <p class="card-snip">${snip}</p>
                <div class="card-foot">
                  <span class="card-score">score ${n(c.lead_score)} · ${via}</span>
                  <span class="card-tags">${wait}${who}</span>
                </div>
              </article>`;
            })
            .join('')
        : `<p class="empty">${i.emptyCol}</p>`;

      return `
        <section class="col">
          <header class="col-head">
            <h2>${escapeHtml(labels[stage] || stage)}</h2>
            <span class="col-count">${cards.length}</span>
          </header>
          <div class="col-body">${body}</div>
        </section>`;
    })
    .join('');

  const compare = workerCompareHint(data);
  el.hint.textContent = compare
    ? `${i.leadsHint(list.length, n(data.hotLeads || 0))} · ${compare}`
    : i.leadsHint(list.length, n(data.hotLeads || 0));
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(state.lang === 'en' ? 'en-GB' : 'ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function closeAccountDrawer() {
  if (!el.drawer) return;
  state.openAccountId = null;
  el.drawer.classList.remove('is-open');
  el.accountsBody?.querySelectorAll('tr.is-active').forEach((r) => r.classList.remove('is-active'));
  window.setTimeout(() => {
    if (!el.drawer.classList.contains('is-open')) {
      el.drawer.hidden = true;
      el.drawer.setAttribute('aria-hidden', 'true');
    }
  }, 340);
}

function openAccountDrawer(account, { keepOpen } = {}) {
  if (!el.drawer || !account) return;
  const i = t();
  const d = i.drawer || {};
  const { title, sub } = displayName(account);
  el.drawerTitle.textContent = title;
  state.openAccountId = account.id;
  const prompt = String(account.prompt || '').trim();
  const promptHtml = prompt
    ? `<pre class="acc-prompt">${escapeHtml(prompt)}</pre>`
    : `<pre class="acc-prompt acc-prompt--empty">${escapeHtml(d.promptEmpty)}</pre>`;
  const safeMedia = safeTelegramHref(account.mediaChatLink);
  const media = safeMedia
    ? `<a class="acc-link" href="${escapeHtml(safeMedia)}" target="_blank" rel="noreferrer">${escapeHtml(account.mediaChatLink)}</a>`
    : account.mediaChatLink
      ? escapeHtml(account.mediaChatLink)
      : '—';
  const rows = [
    [d.phone, sub || account.phone || '—'],
    [d.id, `#${account.id}${account.seq != null ? `  ·  №${account.seq}` : ''}`],
    [d.owner, account.ownerTg ? `${account.owner || '—'} (${account.ownerTg})` : account.owner || '—'],
    [d.status, account.status || '—'],
    [d.net, account.online ? i.online : i.offline],
    [d.ai, account.ai ? d.enabled : d.disabled],
    [d.sentToday, n(account.sentToday)],
    [d.sentWeek, n(account.sentWeek)],
    [d.peers, n(account.peersTotal)],
    [d.delay, delayLabel(account.delayMin, account.delayMax)],
    [d.media, null],
    [d.updated, fmtDate(account.updatedAt)],
    [d.created, fmtDate(account.createdAt)],
  ];

  const rowsHtml = rows
    .map(([k, v]) => {
      if (k === d.media) {
        return `<div class="acc-row"><span>${escapeHtml(k)}</span><strong>${media}</strong></div>`;
      }
      return `<div class="acc-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`;
    })
    .join('');

  el.drawerBody.innerHTML = `
    <div class="acc-rows">${rowsHtml}</div>
    <p class="acc-section-title">${escapeHtml(d.prompt)} · ${n(prompt.length)} ${escapeHtml(d.chars)}</p>
    ${promptHtml}
  `;

  el.accountsBody.querySelectorAll('tr.is-active').forEach((r) => r.classList.remove('is-active'));
  const row = el.accountsBody.querySelector(`tr[data-id="${account.id}"]`);
  if (row) row.classList.add('is-active');

  el.drawer.hidden = false;
  el.drawer.setAttribute('aria-hidden', 'false');
  if (keepOpen && el.drawer.classList.contains('is-open')) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.drawer.classList.add('is-open'));
  });
}

function renderAccounts(data) {
  const i = t();
  const acc = data.accounts || {};
  const list = Array.isArray(acc.list) ? acc.list : [];
  el.accountsHint.textContent = i.accountsHint(n(acc.online), n(acc.total), n(acc.aiOn));
  if (window.OpsAdmin?.onAccounts) window.OpsAdmin.onAccounts(list);
  if (!list.length) {
    el.accountsBody.innerHTML = `<tr><td colspan="6" class="empty">${i.noAccounts}</td></tr>`;
    return;
  }
  el.accountsBody.innerHTML = list
    .map((a) => {
      const { title, sub } = displayName(a);
      const phoneLine = sub
        ? `<div class="acc-name">${escapeHtml(title)}</div><div class="acc-sub">${escapeHtml(sub)}</div>`
        : `<div class="acc-name">${escapeHtml(title)}</div>`;
      const owner = escapeHtml(a.owner || '—');
      const status = a.online
        ? `<span class="pill pill--on"><span class="acc-dot acc-dot--on"></span>${i.online}</span>`
        : `<span class="pill"><span class="acc-dot"></span>${i.offline}</span>`;
      const ai = a.ai
        ? `<span class="pill pill--ai">${i.aiOn}</span>`
        : `<span class="pill">${i.aiOff}</span>`;
      return `<tr data-id="${escapeHtml(a.id)}" tabindex="0">
        <td data-label="Аккаунт">${phoneLine}</td>
        <td data-label="Владелец">${owner}</td>
        <td data-label="Статус">${status}</td>
        <td data-label="AI">${ai}</td>
        <td class="num" data-label="Сегодня">${n(a.sentToday)}</td>
        <td class="num" data-label="Неделя">${n(a.sentWeek)}</td>
      </tr>`;
    })
    .join('');
}

function renderAll(data) {
  state.data = data;
  const i = t();
  const updated = data.computedAt
    ? new Date(data.computedAt).toLocaleTimeString(state.lang === 'en' ? 'en-GB' : 'ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
  el.meta.textContent = i.metaLine(updated, state.refreshSec);
  renderStats(data);
  renderBoard(data);
  renderAccounts(data);
}

async function refresh() {
  try {
    el.refresh.disabled = true;
    const data = await window.ops.fetchConsole();
    renderAll(data);
  } catch (err) {
    el.meta.textContent = err?.message || 'Error';
    showToast(err?.message || 'Error');
    if (!state.data) renderEmptyBoard(err?.message || t().noTokenShort);
  } finally {
    el.refresh.disabled = false;
  }
}
window.refreshOps = refresh;

function schedule() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    refresh();
  }, state.refreshSec * 1000);
}

el.refresh.addEventListener('click', () => refresh());

el.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  el.filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === btn));
  if (state.data) renderBoard(state.data);
});

el.tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  setTab(btn.dataset.tab);
});

el.activityFilters?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-akind]');
  if (!btn) return;
  activityState.kindGroup = btn.dataset.akind || 'all';
  el.activityFilters.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('is-on', c === btn);
  });
  renderActivityList();
});

el.activityRefresh?.addEventListener('click', () => loadActivity(true));

function syncAccessUi(cfg) {
  const i = t();
  if (el.accessBanner) el.accessBanner.hidden = Boolean(cfg?.hasToken);
  if (el.accessStatus) {
    el.accessStatus.classList.remove('is-ok', 'is-bad');
    if (cfg?.hasToken) {
      el.accessStatus.textContent = `${i.accessOk || 'Подключено'}${
        cfg.tokenHint ? ` ${cfg.tokenHint}` : ''
      }`;
      el.accessStatus.classList.add('is-ok');
    } else {
      el.accessStatus.textContent = i.accessNeed || 'Нужен ключ';
      el.accessStatus.classList.add('is-bad');
    }
  }
  if (el.accessToken && cfg?.hasToken && !el.accessToken.value) {
    el.accessToken.placeholder = cfg.tokenHint
      ? `${i.accessTokenPh || ''} (${cfg.tokenHint})`
      : i.accessTokenPh || '';
  }
}

el.accessForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const i = t();
  const token = String(el.accessToken?.value || '').trim();
  try {
    const cfg = await window.ops.getConfig();
    const saved = await window.ops.saveConfig({
      baseUrl: cfg.baseUrl || 'https://loverussian.duckdns.org',
      token: token || undefined,
      refreshSec: cfg.refreshSec || 25,
    });
    if (el.accessToken) el.accessToken.value = '';
    syncAccessUi({ hasToken: true, tokenHint: saved?.tokenHint || cfg.tokenHint });
    showToast(i.accessSaved || 'Ключ сохранён');
    el.meta.textContent = i.loading;
    await refresh();
    schedule();
    setTab('funnel');
  } catch (err) {
    if (el.accessStatus) {
      el.accessStatus.textContent = err?.message || i.bootFail;
      el.accessStatus.classList.add('is-bad');
      el.accessStatus.classList.remove('is-ok');
    }
    showToast(err?.message || i.bootFail);
  }
});

el.themeGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme]');
  if (!btn) return;
  applyTheme(btn.dataset.theme);
  showToast(t().themeSaved);
});

el.langGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-lang]');
  if (!btn) return;
  applyLang(btn.dataset.lang, { toast: true });
});

el.accountsBody.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row || !state.data) return;
  const id = String(row.dataset.id);
  const list = state.data.accounts?.list || [];
  const account = list.find((a) => String(a.id) === id);
  if (account) openAccountDrawer(account);
});

el.accountsBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  e.preventDefault();
  row.click();
});

document.addEventListener('click', (e) => {
  const close = e.target.closest('[data-action="close-account-drawer"]');
  if (close) closeAccountDrawer();
});

function boardCards() {
  return Array.from(document.querySelectorAll('#board .card'));
}

function focusBoardCard(delta) {
  const cards = boardCards();
  if (!cards.length) return;
  state.focusCard = (state.focusCard + delta + cards.length) % cards.length;
  cards.forEach((c, i) => c.classList.toggle('is-focus', i === state.focusCard));
  cards[state.focusCard]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  cards[state.focusCard]?.focus?.();
}

function exportLeadsCsv() {
  const funnel = state.data?.funnel || {};
  const list = Array.isArray(funnel.conversations) ? funnel.conversations : [];
  if (!list.length) {
    showToast(state.lang === 'en' ? 'No leads to export' : 'Нет лидов для CSV');
    return;
  }
  const rows = [['stage', 'peer', 'score', 'worker', 'waiting', 'age_hours', 'snippet']];
  for (const c of list) {
    rows.push([
      c.funnel_stage || '',
      c.peer_username || c.peer_id || '',
      c.lead_score ?? '',
      c.worker || c.account_phone || '',
      c.waiting ? '1' : '0',
      c.age_hours ?? '',
      String(c.snippet || '').replace(/"/g, "'"),
    ]);
  }
  const csv = rows.map((r) => r.map((x) => `"${String(x)}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `loverussian-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(state.lang === 'en' ? 'CSV saved' : 'CSV скачан');
}

function applyDense(on) {
  state.dense = Boolean(on);
  document.body.classList.toggle('is-dense', state.dense);
  try {
    localStorage.setItem('lr-ops-dense', state.dense ? '1' : '0');
  } catch (_) {}
  if (el.dense) el.dense.classList.toggle('is-on', state.dense);
}

function workerCompareHint(data) {
  const list = data?.funnel?.conversations || [];
  const by = {};
  for (const c of list) {
    const w = c.worker || c.account_phone || '—';
    if (!by[w]) by[w] = { hot: 0, wait: 0, n: 0 };
    by[w].n += 1;
    if (Number(c.lead_score) >= 70 || c.funnel_stage === 'day3' || c.funnel_stage === 'day4') {
      by[w].hot += 1;
    }
    if (c.waiting) by[w].wait += 1;
  }
  const top = Object.entries(by)
    .sort((a, b) => b[1].hot - a[1].hot || b[1].n - a[1].n)
    .slice(0, 5)
    .map(([w, v]) => `${w}: ${v.n}·hot${v.hot}·wait${v.wait}`)
    .join(' · ');
  return top;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAccountDrawer();
  const tag = String(e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
  if (state.tab !== 'funnel') return;
  if (e.key === 'j' || e.key === 'J') {
    e.preventDefault();
    focusBoardCard(1);
  } else if (e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    focusBoardCard(-1);
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    showToast(state.lang === 'en' ? 'Pause AI: open miniapp card' : 'Пауза ИИ: открой карточку в миниаппе');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    applyDense(!state.dense);
  }
});

el.dense?.addEventListener('click', () => applyDense(!state.dense));
el.csv?.addEventListener('click', () => exportLeadsCsv());

(async function boot() {
  const ua = navigator.userAgent || '';
  if (/Macintosh|Mac OS X/i.test(ua)) document.body.classList.add('platform-darwin');
  else if (/Linux/i.test(ua) && !/Android/i.test(ua)) document.body.classList.add('platform-linux');
  else document.body.classList.add('platform-win');

  let savedTheme = 'rose';
  let savedLang = 'ru';
  let savedTab = 'funnel';
  try {
    savedTheme = localStorage.getItem(THEME_KEY) || 'rose';
    savedLang = localStorage.getItem(LANG_KEY) || 'ru';
    savedTab = localStorage.getItem(TAB_KEY) || 'funnel';
  } catch (_) {}
  applyTheme(savedTheme);
  applyLang(savedLang);
  setTab(savedTab);
  applyDense(state.dense);
  el.meta.textContent = t().loading;

  try {
    const cfg = await window.ops.getConfig();
    state.refreshSec = cfg.refreshSec || 25;
    syncAccessUi(cfg);
    refreshUpdatesFromServer().catch(() => {});
    if (!cfg.hasToken) {
      el.meta.textContent = t().noToken;
      showToast(t().noTokenShort);
      renderEmptyBoard(t().noTokenShort);
      setTab('settings');
      return;
    }
    await refresh();
    schedule();
  } catch (err) {
    el.meta.textContent = err?.message || t().bootFail;
  }
})();
