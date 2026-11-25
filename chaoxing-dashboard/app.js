/* 学习通作业看板 · 静态版（数据由 GitHub Actions 生成） */
'use strict';

const state = { data: null, days: 14, course: 'all' };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad2 = (n) => String(n).padStart(2, '0');

function fmtDateParts(ms) {
  const d = new Date(ms);
  return { date: pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()), time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) };
}
function fmtGenerated(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function approvalOf(w) {
  if (w.approval) return w.approval;
  const c = Number(w.statusCode);
  if (c === 4) return '已批阅';
  if (c === 3) return '待批阅';
  if (c === 2) return '已过期';
  return '未批阅';
}

function bucket() {
  const works = (state.data && state.data.works) || [];
  const now = Date.now();
  const active = works.filter((w) => w.deadline && w.deadline > now).sort((a, b) => a.deadline - b.deadline);
  const recent = works.filter((w) => w.deadline && w.deadline <= now && w.deadline >= now - state.days * 86400000).sort((a, b) => b.deadline - a.deadline);
  const noDeadline = works.filter((w) => !w.deadline).sort((a, b) => (b.publishAt || 0) - (a.publishAt || 0));
  const pick = (list) => list.filter((w) => state.course === 'all' || w.courseName === state.course);
  return { active: pick(active), recent: pick(recent), noDeadline: pick(noDeadline) };
}

function renderStats() {
  const f = bucket();
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  $('#mActive').textContent = String(f.active.length).padStart(2, '0');
  $('#mPending').textContent = String(f.active.filter((w) => !w.submitted).length).padStart(2, '0');
  $('#mToday').textContent = String(f.active.filter((w) => w.deadline >= dayStart.getTime() && w.deadline < dayEnd).length).padStart(2, '0');
  $('#mRecent').textContent = String(f.recent.length).padStart(2, '0');
  $('#mRecentSub').textContent = '项近 ' + state.days + ' 天';
  $('#activeCount').textContent = String(f.active.length).padStart(2, '0');
  $('#recentCount').textContent = String(f.recent.length).padStart(2, '0');
  $('#noDeadlineCount').textContent = String(f.noDeadline.length).padStart(2, '0');
  $('#rangeNote').textContent = 'RECENT WINDOW — ' + state.days + ' DAYS';
}

function renderFilters() {
  const works = (state.data && state.data.works) || [];
  const names = {};
  works.forEach((w) => { if (w.courseName) names[w.courseName] = 1; });
  const list = Object.keys(names).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (state.course !== 'all' && !names[state.course]) state.course = 'all';
  const wrap = $('#courseFilters');
  wrap.innerHTML = ['<button class="chip' + (state.course === 'all' ? ' is-active' : '') + '" data-course="all" type="button">全部课程</button>']
    .concat(list.map((n) => '<button class="chip' + (state.course === n ? ' is-active' : '') + '" data-course="' + esc(n) + '" type="button" title="' + esc(n) + '">' + esc(n) + '</button>'))
    .join('');
  wrap.querySelectorAll('.chip').forEach((btn) => btn.addEventListener('click', () => {
    state.course = btn.getAttribute('data-course') || 'all';
    renderFilters(); renderAll();
  }));
}

function progressPercent(w) {
  if (!w.publishAt || !w.deadline || w.deadline <= w.publishAt) return 0;
  return Math.max(0, Math.min(100, ((Date.now() - w.publishAt) / (w.deadline - w.publishAt)) * 100));
}
function countdownOf(deadline) {
  const diff = deadline - Date.now();
  if (diff <= 0) return { text: '已截止', cls: 'is-urgent' };
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  let cls = '';
  if (diff <= 86400000) cls = 'is-urgent';
  else if (diff <= 259200000) cls = 'is-soon';
  return { text: d > 0 ? '剩余 ' + d + '天 ' + pad2(h) + ':' + pad2(m) : '剩余 ' + pad2(h) + ':' + pad2(m) + ':' + pad2(sec), cls: cls };
}

function statusBadge(w) {
  const done = !!w.submitted;
  return '<span class="status-badge ' + (done ? 'is-submitted' : 'is-unsubmitted') + '"><span class="status-mark"></span>' + (done ? '已提交' : '未提交') + '</span>';
}

function renderActive() {
  const f = bucket();
  const list = $('#activeList'), empty = $('#activeEmpty');
  if (!f.active.length) { list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = f.active.map((w, i) => {
    const dp = fmtDateParts(w.deadline);
    const cd = countdownOf(w.deadline);
    const parts = [];
    if (w.questionNum) parts.push(w.questionNum + ' 道题');
    if (w.publishText) parts.push('发布 ' + w.publishText);
    if (w.deadlineText) parts.push('截止 ' + w.deadlineText);
    if (!parts.length) parts.push('作业');
    const title = w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title);
    return '<article class="work" style="--elapsed:' + progressPercent(w).toFixed(1) + '%">' +
      '<div class="work__index">' + pad2(i + 1) + '</div>' +
      '<div class="work__body">' +
        '<div class="work__meta"><span class="course-tag" title="' + esc(w.courseName) + '">' + esc(w.courseName) + '</span>' + statusBadge(w) + '<span class="approval">审批 · ' + esc(approvalOf(w)) + '</span></div>' +
        '<h3>' + title + '</h3>' +
        '<div class="work__sub">' + esc(parts.join(' · ')) + '</div>' +
      '</div>' +
      '<div class="work__deadline">' +
        '<span class="deadline__label">DEADLINE / 截止</span>' +
        '<span class="deadline__date">' + dp.date + '</span>' +
        '<span class="deadline__time">' + dp.time + ' · 周' + '日一二三四五六'[new Date(w.deadline).getDay()] + '</span>' +
        '<span class="countdown ' + cd.cls + '" data-deadline="' + w.deadline + '">' + cd.text + '</span>' +
      '</div></article>';
  }).join('');
}

function renderNoDeadline() {
  const f = bucket();
  const section = $('#noDeadlineSection');
  if (!f.noDeadline.length) { section.hidden = true; return; }
  section.hidden = false;
  $('#noDeadlineList').innerHTML = f.noDeadline.map((w) => {
    const title = w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title);
    return '<div class="no-deadline-item"><span class="nd-course">' + esc(w.courseName) + '</span><span class="nd-title" title="' + esc(w.title) + '">' + title + '</span><span class="approval nd-approval">审批 · ' + esc(approvalOf(w)) + '</span><span class="nd-status">' + statusBadge(w) + '</span></div>';
  }).join('');
}

function renderRecent() {
  const f = bucket();
  const list = $('#recentList'), empty = $('#recentEmpty');
  if (!f.recent.length) { list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = f.recent.map((w) => {
    const dp = fmtDateParts(w.deadline);
    const title = w.link ? '<a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title) + '</a>' : esc(w.title);
    return '<div class="recent-item"><div class="recent-date">' + dp.date + '<span>' + dp.time + '</span></div>' +
      '<div><div class="recent-title">' + title + '</div><div class="recent-course">' + esc(w.courseName) + ' · 审批 ' + esc(approvalOf(w)) + '</div></div>' +
      statusBadge(w) + '</div>';
  }).join('');
}

function renderAll() { renderStats(); renderActive(); renderNoDeadline(); renderRecent(); }

function tickCountdowns() {
  document.querySelectorAll('.countdown[data-deadline]').forEach((el) => {
    const dl = Number(el.getAttribute('data-deadline'));
    if (!dl) return;
    const cd = countdownOf(dl);
    el.textContent = cd.text;
    el.className = 'countdown ' + cd.cls;
  });
}

function showBanner(title, text) { $('#bannerTitle').textContent = title; $('#bannerText').textContent = text; $('#banner').hidden = false; }

function load() {
  fetch('./data.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.json())
    .then((body) => {
      if (!body || body.ok === false) {
        showBanner('数据不可用', (body && body.error) || 'data.json 尚未生成');
        return;
      }
      state.data = body;
      $('#generatedAt').textContent = '数据时间 / ' + fmtGenerated(body.generatedAt);
      $('#footerTime').textContent = 'LAST SYNC — ' + fmtGenerated(body.generatedAt);
      renderFilters(); renderAll();
    })
    .catch((err) => showBanner('读取失败', String(err && err.message || err) + '（data.json 可能尚未生成）'));
}

function bind() {
  $('#refreshBtn').addEventListener('click', load);
  document.querySelectorAll('.window-btn').forEach((btn) => btn.addEventListener('click', () => {
    const days = Number(btn.getAttribute('data-days'));
    if (!days || days === state.days) return;
    state.days = days;
    document.querySelectorAll('.window-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderAll();
  }));
  setInterval(tickCountdowns, 1000);
  setInterval(load, 5 * 60 * 1000);
}

(function clock() {
  const t = () => { const d = new Date(); $('#clock').textContent = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + '  ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
  t(); setInterval(t, 1000);
})();

bind();
load();
