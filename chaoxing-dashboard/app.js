/* 学习通作业看板 · 前端 */
'use strict';

const API_BASE = 'https://chaoxing-api.pages.dev';
const TOKEN_KEY = 'cx_auth_token';
const DEVICE_KEY = 'cx_device_id';
let authToken = '';
try { authToken = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { authToken = ''; }

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch (e) { return 'fallback-' + Date.now(); }
}

async function ensureToken(force) {
  if (authToken && !force) return authToken;
  const res = await fetch(API_BASE + '/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId() }),
  });
  const body = await res.json().catch(() => ({}));
  if (body && body.ok && body.token) {
    authToken = body.token;
    try { localStorage.setItem(TOKEN_KEY, authToken); } catch (e) {}
  }
  return authToken;
}

async function apiFetch(path, options) {
  const opts = options || {};
  let token = await ensureToken(false);
  const call = () => fetch(API_BASE + path, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { 'X-Auth-Token': token }) }));
  let res = await call();
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    if (body && body.code === 'AUTH_REQUIRED') {
      token = await ensureToken(true);
      res = await call();
    }
  }
  return res;
}

const state = {
  data: null,
  days: 14,
  course: 'all',
  loading: false,
  timer: null,
  loginSession: null,
  loginPoll: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 提交状态：完全依据学习通返回的作业状态（未查看=未提交，待批阅/已完成=已提交） */
function isSubmitted(w) { return Boolean(w && w.submitted); }
function statusToggle(w) {
  const submitted = isSubmitted(w);
  return '<span class="status-badge ' + (submitted ? 'is-submitted' : 'is-unsubmitted') + '">' +
    '<span class="status-mark"></span>' + (submitted ? '已提交' : '未提交') + '</span>';
}

function approvalLabel(w) {
  if (w.approval) return w.approval;
  const text = String(w.statusText || '');
  if (/已完成|已批阅|已评分/.test(text) || Number(w.statusCode) === 4) return '已批阅';
  if (/待批阅|待评分/.test(text) || Number(w.statusCode) === 3) return '待批阅';
  if (Number(w.statusCode) === 2) return '已过期';
  return '未批阅';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDateParts(ms) {
  const d = new Date(ms);
  return {
    date: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()),
    time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
    dateTime: d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
  };
}

function fmtGenerated(iso) {
  try {
    const d = new Date(iso);
    return '数据时间 / ' + d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  } catch { return '—'; }
}

function filtered() {
  const d = state.data;
  if (!d) return { active: [], recent: [], noDeadline: [] };
  const match = (w) => state.course === 'all' || w.courseName === state.course;
  const since = Date.now() - state.days * 86400000;
  return {
    active: d.active.filter(match),
    recent: d.recent.filter(match).filter((w) => w.deadline && w.deadline >= since),
    noDeadline: d.noDeadline.filter(match),
  };
}

function renderStats() {
  const d = state.data;
  if (!d) return;
  const f = filtered();
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  const activePending = f.active.filter((w) => !isSubmitted(w)).length;
  const dueToday = f.active.filter((w) => w.deadline >= dayStart.getTime() && w.deadline < dayEnd).length;

  $('#mActive').textContent = String(f.active.length).padStart(2, '0');
  $('#mPending').textContent = String(activePending).padStart(2, '0');
  $('#mToday').textContent = String(dueToday).padStart(2, '0');
  $('#mRecent').textContent = String(f.recent.length).padStart(2, '0');
  $('#mRecentSub').textContent = '项近 ' + state.days + ' 天记录';
  $('#activeCount').textContent = String(f.active.length).padStart(2, '0');
  $('#recentCount').textContent = String(f.recent.length).padStart(2, '0');
  $('#noDeadlineCount').textContent = String(f.noDeadline.length).padStart(2, '0');
  $('#rangeNote').textContent = 'RECENT WINDOW — ' + state.days + ' DAYS';
}

function renderFilters() {
  const d = state.data;
  if (!d) return;
  const names = new Set();
  [...d.active, ...d.recent, ...d.noDeadline].forEach((w) => names.add(w.courseName));
  if (state.course !== 'all' && !names.has(state.course)) state.course = 'all';
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const wrap = $('#courseFilters');
  const chips = [];
  chips.push('<button class="chip' + (state.course === 'all' ? ' is-active' : '') + '" data-course="all" type="button">全部课程</button>');
  for (const name of sorted) {
    chips.push('<button class="chip' + (state.course === name ? ' is-active' : '') + '" data-course="' + esc(name) + '" type="button" title="' + esc(name) + '">' + esc(name) + '</button>');
  }
  wrap.innerHTML = chips.join('');
  wrap.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.course = btn.getAttribute('data-course') || 'all';
      renderFilters();
      renderAll();
    });
  });
}

function progressPercent(w) {
  if (!w.publishAt || !w.deadline || w.deadline <= w.publishAt) return 0;
  const p = ((Date.now() - w.publishAt) / (w.deadline - w.publishAt)) * 100;
  return Math.max(0, Math.min(100, p));
}

function countdownHtml(deadline) {
  const diff = deadline - Date.now();
  if (diff <= 0) return '<span class="countdown is-urgent">已截止</span>';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  let cls = '';
  if (diff <= 24 * 3600 * 1000) cls = ' is-urgent';
  else if (diff <= 72 * 3600 * 1000) cls = ' is-soon';
  const text = days > 0
    ? '剩余 ' + days + '天 ' + pad2(hours) + ':' + pad2(mins)
    : '剩余 ' + pad2(hours) + ':' + pad2(mins) + ':' + pad2(secs);
  return '<span class="countdown' + cls + '" data-deadline="' + deadline + '">' + text + '</span>';
}

function renderActive() {
  const f = filtered();
  const list = $('#activeList');
  const empty = $('#activeEmpty');
  if (!f.active.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = f.active.map((w, i) => {
    const dp = fmtDateParts(w.deadline);
    const subParts = [];
    if (w.questionNum) subParts.push(w.questionNum + ' 道题');
    if (w.publishText) subParts.push('发布 ' + w.publishText);
    if (w.deadlineText) subParts.push('截止 ' + w.deadlineText);
    if (!subParts.length) subParts.push('作业');
    return '' +
      '<article class="work" style="--elapsed:' + progressPercent(w).toFixed(1) + '%">' +
        '<div class="work__index">' + pad2(i + 1) + '</div>' +
        '<div class="work__body">' +
          '<div class="work__meta">' +
            '<span class="course-tag" title="' + esc(w.courseName) + '">' + esc(w.courseName) + '</span>' +
            statusToggle(w) +
            '<span class="approval">审批 · ' + esc(approvalLabel(w)) + '</span>' +
          '</div>' +
          '<h3>' + (w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title)) + '</h3>' +
          '<div class="work__sub">' + esc(subParts.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="work__deadline">' +
          '<span class="deadline__label">DEADLINE / 截止</span>' +
          '<span class="deadline__date">' + dp.date + '</span>' +
          '<span class="deadline__time">' + dp.time + ' · 周' + '日一二三四五六'[new Date(w.deadline).getDay()] + '</span>' +
          countdownHtml(w.deadline) +
        '</div>' +
      '</article>';
  }).join('');
}

function renderNoDeadline() {
  const f = filtered();
  const section = $('#noDeadlineSection');
  if (!f.noDeadline.length) { section.hidden = true; return; }
  section.hidden = false;
  $('#noDeadlineList').innerHTML = f.noDeadline.map((w) => {
    return '<div class="no-deadline-item">' +
      '<span class="nd-course">' + esc(w.courseName) + '</span>' +
      '<span class="nd-title" title="' + esc(w.title) + '">' + (w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title)) + '</span>' +
      '<span class="approval nd-approval">审批 · ' + esc(approvalLabel(w)) + '</span>' +
      '<span class="nd-status">' + statusToggle(w) + '</span>' +
    '</div>';
  }).join('');
}

function renderRecent() {
  const f = filtered();
  const list = $('#recentList');
  const empty = $('#recentEmpty');
  if (!f.recent.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = f.recent.map((w) => {
    const dp = fmtDateParts(w.deadline);
    return '<div class="recent-item">' +
      '<div class="recent-date">' + dp.date + '<span>' + dp.time + '</span></div>' +
      '<div><div class="recent-title">' + (w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title)) + '</div><div class="recent-course">' + esc(w.courseName) + ' · 审批 ' + esc(approvalLabel(w)) + '</div></div>' +
      statusToggle(w) +
    '</div>';
  }).join('');
}

function renderAll() {
  renderStats();
  renderActive();
  renderNoDeadline();
  renderRecent();
}

function updateCountdowns() {
  document.querySelectorAll('.countdown[data-deadline]').forEach((el) => {
    const deadline = Number(el.getAttribute('data-deadline'));
    if (!deadline) return;
    const diff = deadline - Date.now();
    if (diff <= 0) {
      el.textContent = '已截止';
      el.classList.add('is-urgent');
      return;
    }
    const totalSec = Math.floor(diff / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    el.textContent = days > 0
      ? '剩余 ' + days + '天 ' + pad2(hours) + ':' + pad2(mins)
      : '剩余 ' + pad2(hours) + ':' + pad2(mins) + ':' + pad2(secs);
    el.classList.toggle('is-urgent', diff <= 24 * 3600 * 1000);
    el.classList.toggle('is-soon', diff > 24 * 3600 * 1000 && diff <= 72 * 3600 * 1000);
  });
}

function showBanner(title, text) {
  $('#bannerTitle').textContent = title;
  $('#bannerText').textContent = text;
  $('#banner').hidden = false;
}
function hideBanner() { $('#banner').hidden = true; }

async function loadData(force) {
  if (state.loading) return;
  state.loading = true;
  const btn = $('#refreshBtn');
  btn.disabled = true;
  btn.querySelector('span').textContent = '同步中';
  try {
    const url = '/api/assignments?days=' + state.days + (force ? '&refresh=1' : '');
    const res = await apiFetch(url, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      const msg = body.error || ('HTTP ' + res.status);
      if (body.code === 'AUTH_EXPIRED' || res.status === 401) {
        showBanner('登录态已失效', msg + ' 点击右上角「扫码登录」，用学习通 App 扫码即可自动更新登录状态。');
        if (!state.data) setTimeout(openLoginModal, 500);
      } else {
        showBanner('数据读取失败', msg);
      }
      return;
    }
    state.data = body;
    hideBanner();
    renderFilters();
    renderAll();
    $('#generatedAt').textContent = fmtGenerated(body.stats.generatedAt);
    $('#footerTime').textContent = 'LAST SYNC — ' + fmtGenerated(body.stats.generatedAt).replace('数据时间 / ', '');
    if (body.stats.failedCourses > 0) {
      showBanner('部分课程读取失败', '有 ' + body.stats.failedCourses + ' 门课程未能读取，其余数据已正常汇总。');
    }
  } catch (err) {
    showBanner('网络错误', String(err && err.message || err));
  } finally {
    state.loading = false;
    btn.disabled = false;
    btn.querySelector('span').textContent = '刷新数据';
  }
}

/* -------------------------------------------------------------- 扫码登录 */
function setLoginStatus(text, ok) {
  const el = $('#loginStatus');
  el.textContent = text;
  el.classList.toggle('is-ok', !!ok);
}

function closeLoginModal() {
  $('#loginModal').hidden = true;
  if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; }
  state.loginSession = null;
}

async function loadQr() {
  if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; }
  state.loginSession = null;
  setLoginStatus('正在获取二维码…');
  $('#loginQr').removeAttribute('src');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await apiFetch('/api/login/qr', { cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timer));
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || '二维码获取失败');
    state.loginSession = body.sessionId;
    $('#loginQr').src = body.qr;
    setLoginStatus('请使用学习通 App 扫描二维码');
    state.loginPoll = setInterval(pollLogin, 1500);
  } catch (err) {
    const msg = String(err && err.message || err);
    setLoginStatus('二维码加载失败' + (msg.indexOf('abort') >= 0 ? '（超时）' : '：' + msg) + '，请点「刷新二维码」重试，或改用「账号密码」登录');
  }
}

async function pollLogin() {
  if (!state.loginSession) return;
  try {
    const res = await apiFetch('/api/login/status?session=' + encodeURIComponent(state.loginSession), { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (body.status === 'success') {
      if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; }
      setLoginStatus('登录成功，正在刷新数据…', true);
      setTimeout(() => {
        closeLoginModal();
        loadData(true).then(() => {
          if (!state.data) showBanner('登录成功但读取失败', '已获取登录态，但作业数据读取失败，请稍后点「刷新数据」重试。');
        });
      }, 600);
      return;
    }
    if (body.status === 'scanned') setLoginStatus('已扫码，请在手机上点击「确认登录」', true);
    else if (body.status === 'expired') {
      if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; }
      setLoginStatus('二维码已失效，正在刷新…');
      setTimeout(() => { if (!$('#loginModal').hidden) loadQr(); }, 800);
    }
    else if (body.status === 'cancelled' || body.status === 'error') { if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; } setLoginStatus(body.message || '登录失败，请重试'); }
    else setLoginStatus(body.message || '等待扫码…');
  } catch { /* 网络抖动不打断轮询 */ }
}

function switchLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab));
  $('#loginQrPane').hidden = tab !== 'qr';
  $('#loginPwdPane').hidden = tab !== 'pwd';
  if (tab === 'qr') { loadQr(); return; }
  if (state.loginPoll) { clearInterval(state.loginPoll); state.loginPoll = null; }
  const user = $('#loginUser');
  if (user) setTimeout(() => user.focus(), 60);
}

async function submitPassword() {
  const username = ($('#loginUser').value || '').trim();
  const password = $('#loginPass').value || '';
  const status = $('#loginPwdStatus');
  if (!username || !password) {
    status.textContent = '请输入账号和密码';
    status.classList.remove('is-ok');
    return;
  }
  $('#loginSubmit').disabled = true;
  status.textContent = '正在登录…';
  status.classList.remove('is-ok');
  try {
    const res = await apiFetch('/api/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.ok) {
      status.textContent = '登录成功，正在刷新数据…';
      status.classList.add('is-ok');
      setTimeout(() => { closeLoginModal(); loadData(true); }, 600);
    } else {
      status.textContent = body.error || '登录失败，请检查账号密码';
    }
  } catch (err) {
    status.textContent = '网络错误：' + String(err && err.message || err);
  } finally {
    $('#loginSubmit').disabled = false;
  }
}

function openLoginModal() {
  $('#loginModal').hidden = false;
  switchLoginTab('pwd');
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $('#clock').textContent = now.getFullYear() + '.' + pad2(now.getMonth() + 1) + '.' + pad2(now.getDate()) + '  ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  };
  tick();
  setInterval(tick, 1000);
}

function bind() {
  $('#refreshBtn').addEventListener('click', () => loadData(true));
  $('#loginBtn').addEventListener('click', openLoginModal);
  $('#loginClose').addEventListener('click', closeLoginModal);
  $('#loginRefresh').addEventListener('click', loadQr);
  document.querySelectorAll('.login-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchLoginTab(btn.getAttribute('data-tab') || 'qr'));
  });
  $('#loginSubmit').addEventListener('click', submitPassword);
  ['loginUser', 'loginPass'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitPassword(); });
  });
  $('#loginModal').addEventListener('click', (event) => {
    if (event.target === $('#loginModal')) closeLoginModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#loginModal').hidden) closeLoginModal();
  });
  document.querySelectorAll('.window-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = Number(btn.getAttribute('data-days'));
      if (!days || days === state.days) return;
      state.days = days;
      document.querySelectorAll('.window-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      loadData(false);
    });
  });
  setInterval(() => loadData(false), 60000);
  setInterval(updateCountdowns, 1000);
}

startClock();
bind();
loadData(false);
if (new URLSearchParams(location.search).get('login') === '1') {
  setTimeout(openLoginModal, 600);
}
