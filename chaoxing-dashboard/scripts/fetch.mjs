#!/usr/bin/env node
/**
 * 学习通作业看板 · 静态数据生成器
 * 在 GitHub Actions 里运行：登录学习通 -> 抓课程/作业/考试 -> 写 docs/data.json
 *
 * 环境变量：
 *   CHAOXING_USERNAME   学习通账号（学号/手机号）
 *   CHAOXING_PASSWORD   学习通密码
 *   可选：COOKIES_JSON  直接提供 cookie 数组 JSON
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_COOKIES = path.join(CACHE_DIR, 'cookies.json');
const OUT = path.join(ROOT, 'data.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
const LOGIN_PAGE = 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com';

class CookieJar {
  constructor(cookies) { this.cookies = cookies || []; }
  addFromResponse(headers, url) {
    const host = new URL(url).hostname.toLowerCase();
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const raw of list) {
      const parts = String(raw).split(';').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const eq = parts[0].indexOf('=');
      if (eq <= 0) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1);
      const attrs = {};
      for (const part of parts.slice(1)) {
        const i = part.indexOf('=');
        if (i > 0) attrs[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
        else attrs[part.toLowerCase()] = '';
      }
      const domain = (attrs.domain || host).toLowerCase();
      const cookiePath = attrs.path || '/';
      let expires = -1;
      if (attrs['max-age'] !== undefined) expires = Date.now() / 1000 + Number(attrs['max-age']);
      else if (attrs.expires) expires = Date.parse(attrs.expires) / 1000;
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain && c.path === cookiePath));
      this.cookies.push({ name, value, domain, path: cookiePath, expires: Number.isFinite(expires) ? expires : -1, httpOnly: 'httponly' in attrs, secure: 'secure' in attrs });
    }
  }
  headerFor(url) {
    const u = new URL(url), host = u.hostname.toLowerCase(), p = u.pathname || '/', now = Date.now() / 1000;
    return this.cookies.filter((c) => {
      if (c.expires > 0 && c.expires < now) return false;
      const d = String(c.domain || '').toLowerCase();
      const dm = d.startsWith('.') ? (host === d.slice(1) || host.endsWith(d)) : host === d;
      return dm && p.startsWith(c.path || '/');
    }).map((c) => c.name + '=' + c.value).join('; ');
  }
  chaoxing() { return this.cookies.filter((c) => /(^|\.)chaoxing\.com$/.test(String(c.domain || '').toLowerCase())); }
  hasAuth() { return this.chaoxing().some((c) => c.name === 'p_auth_token' || c.name === 'cx_p_token'); }
}

async function jarFetch(url, jar, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const cookie = jar.headerFor(url);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual' });
  jar.addFromResponse(res.headers, url);
  return res;
}
async function jarFollow(url, jar, maxHops = 10) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await jarFetch(current, jar, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

function aesLogin(text) {
  const key = Buffer.from('u2oh6Vu^HWe4_AES', 'utf8');
  const c = crypto.createCipheriv('aes-128-cbc', key, key);
  return Buffer.concat([c.update(Buffer.from(String(text), 'utf8')), c.final()]).toString('base64');
}

async function loginPassword(username, password) {
  const jar = new CookieJar();
  const body = new URLSearchParams({
    fid: '-1', uname: aesLogin(username), password: aesLogin(password),
    refer: 'https%3A%2F%2Fi.chaoxing.com', t: 'true', forbidotherlogin: '0', validate: '',
  });
  const res = await jarFetch('https://passport2.chaoxing.com/fanyalogin', jar, {
    method: 'POST',
    headers: {
      'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', Referer: LOGIN_PAGE,
    },
    body,
  });
  let data = {};
  try { data = JSON.parse(await res.text()); } catch { data = {}; }
  if (data.status !== true && data.status !== 'true') throw new Error(data.msg2 || data.msg || data.mes || '账号或密码错误');
  for (const u of [data.url, 'https://i.chaoxing.com', 'http://i.mooc.chaoxing.com/space/index']) {
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) { try { await jarFollow(u, jar); } catch { /* ignore */ } }
  }
  if (!jar.hasAuth()) throw new Error('登录成功但未取得登录票据');
  return jar;
}

async function getJson(url, jar, referer) {
  const res = await jarFetch(url, jar, { headers: { 'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: referer || 'https://mooc1.chaoxing.com/' } });
  const text = await res.text();
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  return JSON.parse(text);
}
async function getText(url, jar, referer) {
  const res = await jarFetch(url, jar, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', Referer: referer || 'https://mooc1.chaoxing.com/' } });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  return res.text();
}

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function cleanText(html) { return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }

function approvalOf(code, text) {
  const t = String(text || '');
  if (code === 4 || /已完成|已批阅|已评分/.test(t)) return '已批阅';
  if (code === 3 || /待批阅|待评分/.test(t)) return '待批阅';
  if (code === 2) return '已过期';
  return '未批阅';
}

async function fetchCourses(jar) {
  const data = await getJson('https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&getTchClazzType=1&mcode=', jar, 'https://i.chaoxing.com/');
  if (!data || data.result !== 1) throw new Error((data && (data.msg || data.errorMsg)) || '未登录');
  const seen = new Set(); const out = [];
  for (const ch of data.channelList || []) {
    const content = ch.content || {};
    const course = (content.course && content.course.data && content.course.data[0]) || {};
    const classId = String(content.id || ''), courseId = String(course.id || '');
    if (!classId || !courseId) continue;
    const key = courseId + '|' + classId;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ name: course.name || content.name || '未命名课程', classId, courseId, cpi: String(content.cpi || course.cpi || '') });
  }
  return out;
}

function parseWorkList(html) {
  const items = []; const re = /<dt\b([^>]*)>([\s\S]*?)<\/dt>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], inner = m[2];
    const dataMatch = attrs.match(/\bdata="([^"]*)"/);
    if (!dataMatch) continue;
    const dataPath = decodeEntities(dataMatch[1]);
    const statusMatch = attrs.match(/\bstatus="([^"]*)"/);
    const q = new URLSearchParams(dataPath.split('?')[1] || '');
    items.push({
      wrId: q.get('taskrefId') || '',
      title: cleanText((inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/) || [])[1]),
      actionText: cleanText((inner.match(/<b\b[^>]*>([\s\S]*?)<\/b>/) || [])[1]),
      httpStatus: Number(statusMatch ? statusMatch[1] : 0) || 0,
      link: 'https://mooc1-api.chaoxing.com' + (dataPath.startsWith('/') ? '' : '/') + dataPath,
    });
  }
  return items;
}

async function fetchCourseWorks(course, jar) {
  const workUrl = 'https://mooc1-api.chaoxing.com/phone/moocAnalysis/workList?courseId=' + encodeURIComponent(course.courseId) + '&classId=' + encodeURIComponent(course.classId);
  const statUrl = 'https://stat2-ans.chaoxing.com/work-stastics/stu-works?page=1&pageSize=100&courseid=' + encodeURIComponent(course.courseId) + '&clazzid=' + encodeURIComponent(course.classId) + '&cpi=' + encodeURIComponent(course.cpi) + '&personId=' + encodeURIComponent(course.cpi) + '&ut=s';
  const statRef = 'https://stat2-ans.chaoxing.com/stat2/work-stastics/stu-index?courseid=' + course.courseId + '&clazzid=' + course.classId + '&cpi=' + course.cpi + '&ut=s';
  const examUrl = 'https://stat2-ans.chaoxing.com/exam-stastics/stu-exams?page=1&pageSize=100&courseid=' + encodeURIComponent(course.courseId) + '&clazzid=' + encodeURIComponent(course.classId) + '&cpi=' + encodeURIComponent(course.cpi) + '&personId=' + encodeURIComponent(course.cpi);
  const examRef = 'https://stat2-ans.chaoxing.com/stat2/exam-stastics/stu-index?courseid=' + course.courseId + '&clazzid=' + course.classId + '&cpi=' + course.cpi + '&ut=s';

  const results = await Promise.allSettled([getText(workUrl, jar), getJson(statUrl, jar, statRef), getJson(examUrl, jar, examRef)]);
  const html = results[0].status === 'fulfilled' ? results[0].value : '';
  const statData = results[1].status === 'fulfilled' && Array.isArray(results[1].value.data) ? results[1].value.data : [];
  const examData = results[2].status === 'fulfilled' && Array.isArray(results[2].value.data) ? results[2].value.data : [];

  const htmlById = new Map(parseWorkList(html).map((h) => [h.wrId, h]));
  const works = []; const used = new Set();

  for (const s of statData) {
    const id = String(s.wrId || '');
    const h = htmlById.get(id); used.add(id);
    works.push({
      id: id || String(s.title),
      title: cleanText(s.title || (h && h.title) || '未命名作业'),
      courseName: course.name, courseId: course.courseId, classId: course.classId,
      type: 'work',
      publishAt: Number(s.beginTimeLong) > 0 ? Number(s.beginTimeLong) : null,
      publishText: s.beginDate || '',
      deadline: Number(s.endTimeLong) > 0 ? Number(s.endTimeLong) : null,
      deadlineText: s.endDate || '',
      statusCode: Number(s.status) || 0,
      statusText: s.statusStr || '',
      submitted: [3, 4, 6, 7].includes(Number(s.status)),
      approval: approvalOf(Number(s.status) || 0, s.statusStr || ''),
      questionNum: Number(s.questionNum) || 0,
      link: (h && h.link) || '',
    });
  }
  for (const h of htmlById.values()) {
    if (used.has(h.wrId)) continue;
    works.push({
      id: h.wrId || h.title, title: h.title, courseName: course.name, courseId: course.courseId, classId: course.classId,
      type: 'work', publishAt: null, publishText: '', deadline: null, deadlineText: '',
      statusCode: h.httpStatus, statusText: h.actionText,
      submitted: /已完成|待批阅|待评分/.test(h.actionText), approval: approvalOf(h.httpStatus, h.actionText),
      questionNum: 0, link: h.link,
    });
  }
  for (const e of examData) {
    works.push({
      id: 'exam-' + String(e.wrId || e.title),
      title: cleanText(e.title || e.titleAll || '未命名考试'),
      courseName: course.name, courseId: course.courseId, classId: course.classId,
      type: 'exam',
      publishAt: Number(e.beginTimeLong) > 0 ? Number(e.beginTimeLong) : null,
      publishText: e.beginDate || '',
      deadline: Number(e.endTimeLong) > 0 ? Number(e.endTimeLong) : null,
      deadlineText: e.endDate || '',
      statusCode: Number(e.status) || 0,
      statusText: e.statusStr || '',
      submitted: [3, 4, 6, 7].includes(Number(e.status)),
      approval: approvalOf(Number(e.status) || 0, e.statusStr || ''),
      questionNum: Number(e.questionNum) || 0,
      link: '',
    });
  }
  return works;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) { const i = cursor++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function main() {
  let jar = null;
  // 1) 环境变量直接给 cookie
  if (process.env.COOKIES_JSON) {
    try { jar = new CookieJar(JSON.parse(process.env.COOKIES_JSON)); } catch { jar = null; }
  }
  // 2) 本地缓存 cookie
  if (!jar) {
    try { jar = new CookieJar(JSON.parse(await fs.readFile(CACHE_COOKIES, 'utf8'))); } catch { jar = null; }
  }
  // 3) 验证 cookie，失效则用账号密码重新登录
  let courses = null;
  if (jar) {
    try { courses = await fetchCourses(jar); } catch { courses = null; }
  }
  if (!courses) {
    const username = process.env.CHAOXING_USERNAME, password = process.env.CHAOXING_PASSWORD;
    if (!username || !password) throw new Error('登录态失效且未配置 CHAOXING_USERNAME / CHAOXING_PASSWORD');
    console.log('登录态失效，使用账号密码登录…');
    jar = await loginPassword(username, password);
    courses = await fetchCourses(jar);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_COOKIES, JSON.stringify(jar.chaoxing(), null, 2));
  } else {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_COOKIES, JSON.stringify(jar.chaoxing(), null, 2));
  }

  console.log('课程数：' + courses.length);
  const perCourse = await mapLimit(courses, 5, async (course) => {
    try { return await fetchCourseWorks(course, jar); }
    catch (err) { console.warn('课程读取失败：' + course.name + ' — ' + err.message); return []; }
  });
  const works = perCourse.flat();

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'github-actions',
    courseCount: courses.length,
    works,
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(data, null, 2));
  console.log('已写入 ' + path.relative(ROOT, OUT) + '，作业 ' + works.length + ' 条');
}

main().catch((err) => {
  console.error('生成失败：' + (err && err.message || err));
  process.exitCode = 1;
});
