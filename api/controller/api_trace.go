package controller

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// GetAPITraceUI godoc
// @Summary API调用过程调试页面
// @Description 按 request_id 聚合一次 API 调用的访问日志与 SQL 日志，按时间升序展示
// @Tags SystemLog
// @Produce html
// @Success 200 {string} string "HTML page"
func GetAPITraceUI(c *gin.Context) {
	html := strings.Replace(apiTraceUIHTML, "<!--SYSLOG_NAV-->", SystemLogNavHTML("/api/system_logs/api_trace/ui"), 1)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// GetAPITraceDebugFlags godoc
// @Summary 调试开关实时状态
// @Description 返回服务端 DEBUG_SQL / DEBUG_REDIS 是否开启，供 trace UI 横幅展示
// @Tags SystemLog
// @Produce json
// @Success 200 {object} model.CommonResponse{data=map[string]bool}
// @Router /api/system_logs/api_trace/debug_flags [get]
func GetAPITraceDebugFlags(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"debug_sql":   config.DebugSQLEnabled,
		"debug_redis": config.DebugRedisEnabled,
	}))
}

const apiTraceUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>53AIHub API 调用过程</title>
  <style>
    :root { --bg:#f5f7fb; --card:#fff; --line:#dde3ea; --text:#1c2633; --muted:#64748b; --brand:#0f766e; --sql:#eef4ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    .wrap { max-width: 1400px; margin: 24px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
    .grid { display:grid; grid-template-columns: 1fr 2fr 1fr 1fr auto auto; gap: 10px; align-items: end; }
    label { font-size: 12px; color: var(--muted); display:block; margin-bottom: 4px; }
    input, select, button { width:100%; border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
    button { cursor:pointer; background:#fff; }
    .btn-primary { background: var(--brand); color:#fff; border-color: var(--brand); }
    .status { font-size:12px; color: var(--muted); margin-top:8px; }
    table { width:100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
    th, td { border-bottom: 1px solid var(--line); text-align:left; padding:6px; font-size: 12px; vertical-align: top; word-break: break-word; }
    th { background:#f8fafc; font-size:11px; color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .msg { white-space: pre-wrap; margin:0; font-size:12px; line-height:1.4; }
    tr.is-sql td { background: var(--sql); }
    .hint { font-size:12px; color: var(--muted); margin-top:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <!--SYSLOG_NAV-->
      <div style="margin-bottom:4px;">
        <h2 style="margin:0;">API 调用过程</h2>
      </div>
      <div id="dbgFlags" style="background:#fff7e6;border:1px solid #f2c078;color:#7a4a00;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:10px;">正在检查服务端调试开关…</div>
      <div class="hint">先从响应头 <span class="mono">X-Request-ID</span> 或「请求完成」日志拿到 request_id。上表为精确关联（SQL 日志带 request_id）；model 层裸查尚未透传 ctx 时，用下表「同窗口推测」回捞。</div>
      <div class="grid" style="margin-top:10px;">
        <div><label>Token（FILE_LOG_VIEWER_ACCESS_TOKEN）</label><input id="token" type="password" placeholder="Bearer token 或原文" /></div>
        <div><label>request_id（必填）</label><input id="requestId" placeholder="例如 9f3a…" /></div>
        <div><label>日志类型</label><select id="fileType"><option value="all">all</option><option value="main">main</option><option value="error">error</option><option value="slow">slow</option></select></div>
        <div><label>数量（最大200）</label><input id="limit" type="number" value="200" min="1" max="200" /></div>
        <div class="row" style="align-items:end;"><label><input id="includeArchive" type="checkbox" /> 包含归档日志</label></div>
        <div><button id="searchBtn" class="btn-primary">查询</button></div>
        <div><button id="copyBtn" title="把本次精确关联 + 同窗口推测复制为 Markdown 双表">复制 Markdown</button></div>
      </div>
      <div id="status" class="status"></div>
      <div id="summary" style="font-size:13px;font-weight:600;color:#0f766e;margin:6px 0;"></div>
      <table>
        <thead><tr><th style="width:150px;">时间</th><th style="width:70px;">级别</th><th>内容</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
      <h3 style="margin:16px 0 4px; font-size:14px;">同窗口 SQL（推测关联）</h3>
      <div class="hint">按「请求完成」时间 ± cost 回捞窗口内的 SQL。本地单用户调试基本准确；生产高并发下仅供参考，以上表精确关联为准。</div>
      <div id="wstatus" class="status"></div>
      <table>
        <thead><tr><th style="width:150px;">时间</th><th style="width:70px;">级别</th><th>内容</th></tr></thead>
        <tbody id="wtbody"></tbody>
      </table>
    </div>
  </div>
<script>
  const $ = (id) => document.getElementById(id);
  const tokenInput = $('token');
  const LOG_TOKEN_KEY = 'file_log_viewer_token';
  tokenInput.value = localStorage.getItem(LOG_TOKEN_KEY) || localStorage.getItem('token') || localStorage.getItem('access_token') || '';
  tokenInput.addEventListener('input', () => {
    const v = tokenInput.value.trim();
    if (v) localStorage.setItem(LOG_TOKEN_KEY, v);
    else localStorage.removeItem(LOG_TOKEN_KEY);
  });
  async function refreshFlags() {
    const box = $('dbgFlags');
    const t = tokenInput.value.trim().replace(/^Bearer\s+/i, '');
    const headers = {};
    if (t) headers['Authorization'] = 'Bearer ' + t;
    try {
      const r = await fetch('/api/system_logs/api_trace/debug_flags', { headers });
      if (!r.ok) throw 0;
      const j = await r.json();
      const d = (j && j.data) || {};
      const badge = (on, name) => on
        ? '<b style="color:#0f766e;">● ' + name + ' 已开启</b>'
        : '<b style="color:#b42318;">● ' + name + ' 未开启</b>';
      box.innerHTML = '调试开关：' + badge(d.debug_sql, 'DEBUG_SQL') + '　' + badge(d.debug_redis, 'DEBUG_REDIS')
        + '　<span>关着时 SQL/Redis 日志缺失属正常，先开开关再查。</span>';
    } catch (e) {
      box.innerHTML = '调试开关：<b>未知</b>（填 Token 后刷新本页）';
    }
  }
  refreshFlags();
  const sqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
  // 复制 Markdown 用：缓存最近一次查询的两表原始行。
  let lastExact = [], lastWindow = [];
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n, l) => String(n).padStart(l || 2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }
  function isSQL(r) {
    const m = String((r && r.message) || r.raw || '');
    return sqlPattern.test(m) || m.indexOf('[MAIN_DB]') >= 0 || m.indexOf('[SAAS_DB]') >= 0;
  }
  const msgOf = (r) => String((r && r.message) || r.raw || '');
  // 去展示噪音：request_id 已是查询条件无需重复；SQL 行尾调用点后缀保留（定位慢 SQL 来源）。
  function cleanMsg(msg) {
    return String(msg || '')
      .replace(/\[request_id=[^\]]*\]/g, '')
      .replace(/\[(MAIN_DB|SAAS_DB)\] \S+/g, '[$1]')
      .replace(/\s{2,}/g, ' ').trim();
  }
  function durToMs(v, u) {
    switch (u) {
      case 'ns': return v / 1e6;
      case 'µs': case 'us': return v / 1e3;
      case 'ms': return v;
      case 's': return v * 1e3;
      case 'm': return v * 6e4;
      default: return 0;
    }
  }
  // SQL 行自带 [32.214ms] GORM 耗时，用于汇总条累计。
  function parseBracketMs(msg) {
    const m = /\[([\d.]+)(ns|µs|us|ms|s)\]/.exec(String(msg || ''));
    return m ? durToMs(parseFloat(m[1]), m[2]) : 0;
  }
  function fmtMs(v) {
    return v >= 1000 ? (v / 1000).toFixed(2) + 's' : v.toFixed(2) + 'ms';
  }
  function rowKey(r) {
    return (r.timestamp || 0) + '|' + (r.file || '') + '|' + (r.line || 0) + '|' + String(r.message || r.raw || '');
  }
  function appendRow(tb, r) {
    const tr = document.createElement('tr');
    if (isSQL(r)) tr.className = 'is-sql';
    const ttd = document.createElement('td');
    ttd.className = 'mono';
    ttd.textContent = fmtTime(r.timestamp);
    const ltd = document.createElement('td');
    ltd.className = 'mono';
    ltd.textContent = r.level || '';
    const mtd = document.createElement('td');
    const pre = document.createElement('pre');
    pre.className = 'msg mono';
    pre.textContent = cleanMsg(msgOf(r));
    mtd.appendChild(pre);
    tr.append(ttd, ltd, mtd);
    tb.appendChild(tr);
  }
  function sortAsc(a, b) {
    if ((a.timestamp || 0) !== (b.timestamp || 0)) return (a.timestamp || 0) - (b.timestamp || 0);
    if ((a.file || '') !== (b.file || '')) return String(a.file).localeCompare(String(b.file));
    return (a.line || 0) - (b.line || 0);
  }
  // 解析 Go Duration 格式 cost=505.604395ms / 1.2s / 300µs
  function parseCostMs(msg) {
    const m = /cost=([\d.]+)(ns|µs|us|ms|s|m)\b/.exec(String(msg || ''));
    if (!m) return 0;
    const v = parseFloat(m[1]);
    switch (m[2]) {
      case 'ns': return v / 1e6;
      case 'µs': case 'us': return v / 1e3;
      case 'ms': return v;
      case 's': return v * 1e3;
      case 'm': return v * 6e4;
      default: return 0;
    }
  }
  async function search() {
    const requestId = $('requestId').value.trim();
    const status = $('status');
    const tb = $('tbody');
    tb.innerHTML = '';
    $('wtbody').innerHTML = '';
    $('wstatus').textContent = '';
    $('summary').textContent = '';
    if (!requestId) { status.textContent = '请填写 request_id'; return; }
    const t = $('token').value.trim().replace(/^Bearer\s+/i, '');
    const p = new URLSearchParams();
    p.set('request_id', requestId);
    p.set('file_type', $('fileType').value);
    p.set('limit', String(Math.max(1, Math.min(200, Number($('limit').value || 200)))));
    p.set('offset', '0');
    p.set('no_archive', $('includeArchive').checked ? 'false' : 'true');
    const headers = {};
    if (t) { headers['Authorization'] = 'Bearer ' + t; p.set('access_token', t); }
    status.textContent = '查询中…';
    let resp;
    try {
      resp = await fetch('/api/system_logs/file_logs/search?' + p.toString(), { headers });
    } catch (e) {
      status.textContent = '请求失败：' + e.message;
      return;
    }
    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json || json.success === false) {
      status.textContent = '查询失败：' + ((json && json.message) || ('HTTP ' + resp.status));
      return;
    }
    const rows = (((json.data || {}).logs) || []).slice().sort(sortAsc);
    lastExact = rows; lastWindow = [];
    const sqlCount = rows.filter(isSQL).length;
    const redisCount = rows.filter((r) => msgOf(r).indexOf('[REDIS]') >= 0).length;
    let sqlMs = 0, redisMs = 0;
    for (const r of rows) {
      const m = msgOf(r);
      if (isSQL(r)) sqlMs += parseBracketMs(m);
      if (m.indexOf('[REDIS]') >= 0) redisMs += parseCostMs(m);
    }
    const anchor = rows.find((r) => msgOf(r).indexOf('请求完成') >= 0);
    const totalMs = anchor ? parseCostMs(msgOf(anchor)) : 0;
    status.textContent = '精确关联共 ' + rows.length + ' 条（按时间升序）';
    $('summary').textContent = (totalMs ? '本次调用 ' + fmtMs(totalMs) + ' · ' : '')
      + '日志 ' + rows.length + ' 条 · SQL ' + sqlCount + ' 条（累计 ' + fmtMs(sqlMs) + '）'
      + ' · Redis ' + redisCount + ' 次（累计 ' + fmtMs(redisMs) + '）';
    for (const r of rows) appendRow(tb, r);
    await searchWindow(rows, headers);
  }
  // 同窗口推测：按「请求完成」时间 ± cost 回捞窗口内的 SQL。
  // 精确关联要求 SQL 带 request_id；model 裸查尚未透传 ctx 时用此兜底。
  // lazy: 时间窗口推测，若生产高并发下误关联被投诉，再做 model 层 ctx 全量迁移。
  async function searchWindow(exactRows, headers) {
    const wstatus = $('wstatus');
    const wtb = $('wtbody');
    wtb.innerHTML = '';
    const anchor = exactRows.find((r) => msgOf(r).indexOf('请求完成') >= 0) || exactRows[exactRows.length - 1];
    if (!anchor || !anchor.timestamp) {
      wstatus.textContent = '无请求完成锚点，跳过窗口推测';
      return;
    }
    const costMs = parseCostMs(msgOf(anchor));
    const EPS = 1000;
    const start = Math.max(0, Math.floor(anchor.timestamp - Math.ceil(costMs) - EPS));
    const end = Math.ceil(anchor.timestamp + EPS);
    const wp = new URLSearchParams();
    wp.set('file_type', $('fileType').value);
    wp.set('limit', '200');
    wp.set('offset', '0');
    wp.set('start_time', String(start));
    wp.set('end_time', String(end));
    wp.set('no_archive', $('includeArchive').checked ? 'false' : 'true');
    const tok = $('token').value.trim().replace(/^Bearer\s+/i, '');
    if (tok) wp.set('access_token', tok);
    wstatus.textContent = '窗口回捞中…';
    let wresp;
    try {
      wresp = await fetch('/api/system_logs/file_logs/search?' + wp.toString(), { headers });
    } catch (e) {
      wstatus.textContent = '窗口回捞失败：' + e.message;
      return;
    }
    const wjson = await wresp.json().catch(() => null);
    if (!wresp.ok || !wjson || wjson.success === false) {
      wstatus.textContent = '窗口回捞失败：' + ((wjson && wjson.message) || ('HTTP ' + wresp.status));
      return;
    }
    const seen = new Set(exactRows.map(rowKey));
    const cands = (((wjson.data || {}).logs) || []).filter((r) => isSQL(r) && !seen.has(rowKey(r))).sort(sortAsc);
    lastWindow = cands;
    let tip = '窗口内 SQL ' + cands.length + ' 条（' + fmtTime(start) + ' ~ ' + fmtTime(end) + '，推测关联）';
    if ((((wjson.data || {}).logs) || []).length >= 200) tip += '：窗口日志达上限 200，可能截断';
    wstatus.textContent = tip;
    for (const r of cands) appendRow(wtb, r);
  }
  $('searchBtn').addEventListener('click', search);
  $('requestId').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  // 复制为 Markdown：表头 + 汇总 + 精确关联表 + 同窗口推测表，直贴给 AI 调试。
  function mdCell(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }
  function mdTable(rows) {
    const out = ['| 时间 | 级别 | 内容 |', '| --- | --- | --- |'];
    for (const r of rows) out.push('| ' + mdCell(fmtTime(r.timestamp)) + ' | ' + mdCell(r.level) + ' | ' + mdCell(cleanMsg(msgOf(r))) + ' |');
    return out.join('\n');
  }
  function copyMarkdown() {
    const btn = $('copyBtn');
    const say = (t) => { btn.textContent = t; setTimeout(() => { btn.textContent = '复制 Markdown'; }, 1500); };
    if (!lastExact.length && !lastWindow.length) { say('无结果可复制'); return; }
    const md = ['# api_trace request_id=' + $('requestId').value.trim(), '',
      $('summary').textContent, $('status').textContent, '',
      '## 精确关联（' + lastExact.length + ' 条）', mdTable(lastExact), '',
      '## 同窗口 SQL（推测关联，' + lastWindow.length + ' 条）', $('wstatus').textContent, mdTable(lastWindow)].join('\n');
    const done = () => say('已复制');
    const fail = () => say('复制失败');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done, () => fallbackCopy(md, done, fail));
    } else {
      fallbackCopy(md, done, fail);
    }
  }
  // http 非安全上下文 navigator.clipboard 不可用时的降级。
  function fallbackCopy(text, done, fail) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    } catch (e) { fail(); }
  }
  $('copyBtn').addEventListener('click', copyMarkdown);
</script>
</body>
</html>`
