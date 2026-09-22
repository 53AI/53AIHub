package controller

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
	chatdebug "github.com/53AI/53AIHub/service/chat_debug"
	"github.com/gin-gonic/gin"
)

// GetChatDebugUI godoc
// @Summary Chat过程调试页面
// @Description 实时查看/v1/chat/completions过程Trace、意图缩小、RAG召回切片与打分、工具调用和LLM推理
// @Tags SystemLog
// @Produce html
// @Success 200 {string} string "HTML page"
// @Router /api/system_logs/chat_debug/ui [get]
func GetChatDebugUI(c *gin.Context) {
	html := strings.Replace(chatDebugUIHTML, "<!--SYSLOG_NAV-->", SystemLogNavHTML("/api/system_logs/chat_debug/ui"), 1)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// GetChatDebugTraces godoc
// @Summary 获取Chat调试Trace列表
// @Description 获取最近1小时内指定企业的最后10条/v1/chat/completions过程Trace
// @Tags SystemLog
// @Produce json
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=[]chatdebug.TraceSummary}
// @Router /api/system_logs/chat_debug/traces [get]
func GetChatDebugTraces(c *gin.Context) {
	eid, ok := parseChatDebugEID(c)
	if !ok {
		return
	}
	traces, err := chatdebug.ListTraces(c.Request.Context(), eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(traces))
}

// GetChatDebugTraceDetail godoc
// @Summary 获取单个Chat调试Trace详情
// @Description 获取单个Trace包含意图、RAG召回切片打分、工具、Prompt的完整过程数据
// @Tags SystemLog
// @Produce json
// @Param request_id path string true "请求ID"
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=chatdebug.ChatTrace}
// @Router /api/system_logs/chat_debug/traces/{request_id} [get]
func GetChatDebugTraceDetail(c *gin.Context) {
	eid, ok := parseChatDebugEID(c)
	if !ok {
		return
	}
	requestID := c.Param("request_id")
	if requestID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("request_id 参数不能为空"))
		return
	}
	trace, err := chatdebug.GetTraceDetail(context.Background(), eid, requestID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	if trace == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("未找到该 Trace 或已超过 1 小时过期"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(trace))
}

func parseChatDebugEID(c *gin.Context) (int64, bool) {
	eid, err := strconv.ParseInt(c.Query("eid"), 10, 64)
	if err != nil || eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("eid 参数无效"))
		return 0, false
	}
	return eid, true
}

const chatDebugUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat 对话过程调试 · 53AI</title>
<style>
:root {
  --bg: #0b1220;
  --panel: #111c2f;
  --panel2: #17243a;
  --line: #263752;
  --text: #e7edf7;
  --muted: #91a0b8;
  --blue: #63a4ff;
  --green: #43d19a;
  --red: #ff6f91;
  --yellow: #f4c95d;
  --purple: #b388ff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: radial-gradient(circle at 10% 0, #17335c 0, #0b1220 42%);
  color: var(--text);
  font: 14px Inter, system-ui, sans-serif;
  min-height: 100vh;
}
.shell { max-width: 1600px; margin: auto; padding: 24px; }
.top { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; }
.eyebrow { color: var(--blue); font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: bold; }
.top h1 { margin: 5px 0; font-size: 26px; }
.muted { color: var(--muted); }
.nav-links { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.nav-links a button {
  padding: 6px 14px; font-size: 13px; border-radius: 8px; cursor: pointer;
  background: #17243a; color: var(--text); border: 1px solid var(--line);
}
.nav-links a button.active {
  background: #fff4e5; color: #9a5b00; border-color: #f2c078; font-weight: bold;
}
.toolbar, .panel {
  background: rgba(17, 28, 47, 0.95);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 12px 35px rgba(0,0,0,0.3);
}
.toolbar { display: flex; gap: 12px; padding: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.toolbar input, .toolbar select {
  background: #0d1728; border: 1px solid var(--line); border-radius: 8px;
  color: var(--text); padding: 8px 12px; font-size: 13px;
}
.toolbar input:focus { outline: none; border-color: var(--blue); }
.toolbar button {
  background: var(--blue); color: #fff; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; cursor: pointer; font-weight: 500;
}
.toolbar button.secondary { background: #263752; }
.toolbar button:hover { opacity: 0.9; }
.layout { display: grid; grid-template-columns: 380px 1fr; gap: 16px; align-items: start; }
.panel { padding: 18px; }
.panel h2 { margin: 0 0 14px 0; font-size: 17px; display: flex; justify-content: space-between; align-items: center; }
.trace-list { display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 240px); overflow-y: auto; }
.trace-item {
  background: #0d1728; border: 1px solid var(--line); border-radius: 10px;
  padding: 12px; cursor: pointer; transition: all .15s;
}
.trace-item:hover, .trace-item.active { border-color: var(--blue); background: #132038; }
.trace-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.badge.success { background: rgba(67, 209, 154, 0.18); color: var(--green); }
.badge.failed { background: rgba(255, 111, 145, 0.18); color: var(--red); }
.badge.tag { background: rgba(99, 164, 255, 0.15); color: var(--blue); }
.badge.blue { background: rgba(99, 164, 255, 0.18); color: var(--blue); }
.badge.green { background: rgba(67, 209, 154, 0.18); color: var(--green); }
.badge.purple { background: rgba(179, 136, 255, 0.18); color: var(--purple); }
.badge.yellow { background: rgba(244, 201, 93, 0.18); color: var(--yellow); }
.badge.rank-up { background: rgba(67, 209, 154, 0.2); color: var(--green); border: 1px solid rgba(67, 209, 154, 0.4); }
.badge.rank-down { background: rgba(244, 201, 93, 0.2); color: var(--yellow); border: 1px solid rgba(244, 201, 93, 0.4); }
.query-text { font-size: 13px; color: var(--text); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 6px; }
.trace-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.empty-box { text-align: center; color: var(--muted); padding: 60px 20px; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px; }
.metric { background: #0d1728; border: 1px solid var(--line); border-radius: 10px; padding: 12px; text-align: center; }
.metric .label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.metric .value { font-size: 18px; font-weight: bold; color: var(--text); }
.stage-card {
  background: #0d1728; border: 1px solid var(--line); border-radius: 12px;
  margin-bottom: 14px; overflow: hidden;
}
.stage-header {
  padding: 12px 16px; background: rgba(23, 36, 58, 0.8); border-bottom: 1px solid var(--line);
  display: flex; justify-content: space-between; align-items: center; cursor: pointer;
}
.stage-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.stage-body { padding: 16px; font-size: 13px; line-height: 1.5; }
.code-block {
  background: #070d18; border: 1px solid var(--line); border-radius: 8px;
  padding: 12px; font-family: monospace; font-size: 12px; color: #b0c4de;
  white-space: pre-wrap; word-break: break-all; max-height: 380px; overflow-y: auto;
}
.source-card {
  background: #111c2f; border: 1px solid var(--line); border-radius: 8px;
  padding: 12px; margin-bottom: 10px;
}
.source-card:last-child { margin-bottom: 0; }
.source-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.source-score { font-weight: bold; color: var(--green); font-size: 13px; }
.source-content { color: #cbd5e1; font-size: 12px; line-height: 1.5; max-height: 150px; overflow-y: auto; }
.prop-row { display: flex; margin-bottom: 6px; }
.prop-key { width: 120px; color: var(--muted); flex-shrink: 0; }
.prop-val { color: var(--text); flex: 1; word-break: break-word; }
.tag-list { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
</head>
<body>
<main class="shell">
  <!--SYSLOG_NAV-->
  <header class="top">
    <div>
      <div class="eyebrow">REALTIME CHAT DEBUGGER</div>
      <h1>Chat 对话过程调试</h1>
      <div class="muted">/v1/chat/completions 全链路过程跟踪 · 意图缩小 · RAG切片打分 · 工具调用 · 最近 1 小时</div>
    </div>
    <div id="updatedTime" class="muted">等待查询</div>
  </header>

  <div class="toolbar">
    <input id="token" type="password" placeholder="FILE_LOG_VIEWER_ACCESS_TOKEN" style="width:260px;">
    <input id="eid" placeholder="企业 ID (EID)" style="width:140px;">
    <button onclick="refreshTraces()">刷新列表</button>
    <button id="btnAuto" class="secondary" onclick="toggleAutoRefresh()">开启自动刷新</button>
  </div>

  <div class="layout">
    <section class="panel">
      <h2>最近请求 (最后 10 条) <span id="traceCount" class="muted" style="font-size:13px;"></span></h2>
      <input id="search" placeholder="过滤模型 / Query / RequestID..." style="width:100%;margin-bottom:12px;background:#0d1728;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 12px;" oninput="renderList()">
      <div id="traceList" class="trace-list">
        <div class="empty-box">请输入 Token 与企业 ID 后点击查询</div>
      </div>
    </section>

    <section class="panel">
      <h2>链路过程详情 <span id="selectedReqID" class="muted" style="font-size:13px;"></span></h2>
      <div id="traceDetail">
        <div class="empty-box">点击左侧请求查看完整的执行与调优过程</div>
      </div>
    </section>
  </div>
</main>

<script>
const TOKEN_KEY = 'file_log_viewer_token';
const EID_KEY = 'chat_debug_eid';

const tokenInput = document.getElementById('token');
const eidInput = document.getElementById('eid');
tokenInput.value = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('wiki_generation_trace_token') || '';
eidInput.value = localStorage.getItem(EID_KEY) || localStorage.getItem('wiki_generation_trace_eid') || '';

const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token') || urlParams.get('access_token');
const urlEid = urlParams.get('eid');
if (urlToken) {
  tokenInput.value = urlToken;
  localStorage.setItem(TOKEN_KEY, urlToken);
}
if (urlEid) {
  eidInput.value = urlEid;
  localStorage.setItem(EID_KEY, urlEid);
}

tokenInput.addEventListener('input', () => {
  const v = tokenInput.value.trim();
  v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY);
});
eidInput.addEventListener('input', () => {
  const v = eidInput.value.trim();
  v ? localStorage.setItem(EID_KEY, v) : localStorage.removeItem(EID_KEY);
});
let traces = [];
let selectedID = '';
let autoTimer = null;

function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function formatTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatDuration(ms) {
  if (ms === undefined || ms === null || isNaN(ms)) return '0.00s';
  return (ms / 1000).toFixed(2) + 's';
}

function getHeaders() {
  const t = tokenInput.value.trim();
  const headers = {};
  if (t) {
    headers['X-Access-Token'] = t;
    headers['Authorization'] = 'Bearer ' + t;
  }
  return headers;
}

async function refreshTraces() {
  const eid = eidInput.value.trim();
  if (!eid) {
    alert('请输入企业 ID (EID)');
    return;
  }
  const token = tokenInput.value.trim();
  document.getElementById('updatedTime').textContent = '正在刷新...';
  try {
    let url = '/api/system_logs/chat_debug/traces?eid=' + encodeURIComponent(eid);
    if (token) url += '&access_token=' + encodeURIComponent(token);
    const res = await fetch(url, {
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && (data.message || data.error && data.error.message)) || ('HTTP ' + res.status));
    }
    traces = data.data || [];
    document.getElementById('updatedTime').textContent = '更新于 ' + new Date().toLocaleTimeString();
    document.getElementById('traceCount').textContent = traces.length + ' 条';
    renderList();
    if (traces.length > 0 && !selectedID) {
      selectTrace(traces[0].request_id);
    } else if (selectedID) {
      loadDetail(selectedID);
    }
  } catch (err) {
    document.getElementById('updatedTime').textContent = '刷新失败';
    alert('获取 Trace 失败: ' + err.message);
  }
}

function renderList() {
  const filter = document.getElementById('search').value.trim().toLowerCase();
  const filtered = traces.filter(t => {
    return (t.request_id || '').toLowerCase().includes(filter) ||
           (t.model || '').toLowerCase().includes(filter) ||
           (t.original_query || '').toLowerCase().includes(filter);
  });
  const container = document.getElementById('traceList');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-box">暂无匹配的 Trace 记录</div>';
    return;
  }
  container.innerHTML = filtered.map(t => {
    const isAct = t.request_id === selectedID ? ' active' : '';
    const statusClass = t.status === 'success' ? 'success' : 'failed';
    return '<div class="trace-item' + isAct + '" onclick="selectTrace(\'' + esc(t.request_id) + '\')">' +
      '<div class="trace-item-header">' +
        '<span class="badge tag">' + esc(t.model || 'Unknown') + '</span>' +
        '<span class="badge ' + statusClass + '">' + (t.status_code || 200) + '</span>' +
      '</div>' +
      '<div class="query-text">' + esc(t.original_query || '（无用户问题文本）') + '</div>' +
      '<div class="trace-meta">' +
        '<span>' + formatTime(t.started_at) + ' (' + formatDuration(t.duration_ms) + ')</span>' +
        '<span>' + (t.total_tokens || 0) + ' tokens</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function selectTrace(reqID) {
  selectedID = reqID;
  renderList();
  loadDetail(reqID);
}

async function loadDetail(reqID) {
  const eid = eidInput.value.trim();
  const container = document.getElementById('traceDetail');
  document.getElementById('selectedReqID').textContent = reqID;
  container.innerHTML = '<div class="empty-box">加载中...</div>';
  try {
    let url = '/api/system_logs/chat_debug/traces/' + encodeURIComponent(reqID) + '?eid=' + encodeURIComponent(eid);
    const token = tokenInput.value.trim();
    if (token) url += '&access_token=' + encodeURIComponent(token);
    const res = await fetch(url, {
      headers: getHeaders()
    });
    const data = await res.json();
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && (data.message || data.error && data.error.message)) || ('HTTP ' + res.status));
    }
    const trace = data.data;
    if (!trace) {
      container.innerHTML = '<div class="empty-box">Trace 详情为空或已过期</div>';
      return;
    }
    renderDetail(trace);
  } catch (err) {
    container.innerHTML = '<div class="empty-box" style="color:var(--red);">加载详情失败: ' + esc(err.message) + '</div>';
  }
}

function renderDetail(t) {
  const container = document.getElementById('traceDetail');
  let html = '';

  // 1. 顶部指标看板
  html += '<div class="metrics">' +
    '<div class="metric"><div class="label">模型</div><div class="value" style="font-size:15px;color:var(--blue);">' + esc(t.model || '-') + '</div></div>' +
    '<div class="metric"><div class="label">总耗时</div><div class="value">' + formatDuration(t.duration_ms) + '</div></div>' +
    '<div class="metric"><div class="label">状态码</div><div class="value" style="color:' + (t.status === 'success' ? 'var(--green)' : 'var(--red)') + ';">' + (t.status_code || 200) + '</div></div>' +
    '<div class="metric"><div class="label">Prompt Tokens</div><div class="value">' + (t.prompt_tokens || 0) + '</div></div>' +
    '<div class="metric"><div class="label">Completion Tokens</div><div class="value">' + (t.completion_tokens || 0) + '</div></div>' +
    '<div class="metric"><div class="label">Total Tokens</div><div class="value">' + (t.total_tokens || 0) + '</div></div>' +
  '</div>';

  // 2. 调优诊断 Copilot 卡片
  html += renderOptimizationDiagnosis(t);

  // 3. 用户原始问题
  const origQ = t.original_query || (intentStage && intentStage.data && intentStage.data.original_query);
  if (origQ) {
    html += '<div class="stage-card" style="margin-bottom:16px;">' +
      '<div class="stage-header" style="background:#132038;"><span class="stage-title">用户原始问题</span></div>' +
      '<div class="stage-body" style="font-size:15px;font-weight:600;color:#fff;line-height:1.6;">' + esc(origQ) + '</div>' +
    '</div>';
  }

  // 4. 链路报错
  if (t.error) {
    html += '<div class="stage-card" style="border-color:var(--red);">' +
      '<div class="stage-header" style="background:rgba(255,111,145,0.15);color:var(--red);">' +
        '<span class="stage-title">请求异常报错</span>' +
      '</div>' +
      '<div class="stage-body" style="color:var(--red);font-family:monospace;">' + esc(t.error) + '</div>' +
    '</div>';
  }

  // 5. 各细分阶段
  const stages = t.stages || [];
  if (!stages.length) {
    html += '<div class="empty-box">本次请求未记录到细分阶段数据</div>';
  } else {
    stages.forEach((st, idx) => {
      html += renderStageCard(st, idx, t);
    });
  }

  container.innerHTML = html;
}

function renderOptimizationDiagnosis(t) {
  const issues = [];
  const suggestions = [];
  let healthLevel = 'good'; // 'good', 'warning', 'danger'

  const stages = t.stages || [];
  const intentStage = stages.find(s => s.stage === 'intent');
  const ragStage = stages.find(s => s.stage === 'rag');
  const llmStage = stages.find(s => s.stage === 'llm');

  // 错误诊断
  if (t.status === 'failed' || t.error) {
    healthLevel = 'danger';
    issues.push('<strong>链路执行异常：</strong>请求返回错误 ' + esc(t.error || '未知错误'));
    suggestions.push('优先排查各环节报错日志与模型/第三方接口连接情况');
  }

  // 意图与 Query 改写诊断
  if (intentStage && intentStage.data) {
    const idata = intentStage.data;
    const orig = (t.original_query || idata.original_query || '').trim();
    const norm = (idata.normalized_query || '').trim();
    if (idata.intent === 'CHITCHAT') {
      if (healthLevel !== 'danger') healthLevel = 'warning';
      issues.push('<strong>命中 CHITCHAT 闲聊并触发拒答：</strong>用户提问“' + esc(orig || '当前问题') + '”被判定为闲聊意图，未执行知识库检索并直接输出拒答回复');
      suggestions.push('1. 若提问属于多轮上下文追问（如“那XX呢”、“为什么没有XX”），说明意图模型未有效结合历史上下文消解指代，建议调优意图分类 Prompt；2. 若希望在闲聊或无知识时仍由 AI 正常回答，可将 Agent 的超纲回复设为“继续生成模式”');
    } else if (orig && norm && orig !== norm) {
      if (orig.length > 6 && norm.length < 3) {
        if (healthLevel !== 'danger') healthLevel = 'warning';
        issues.push('<strong>意图改写可能过简：</strong>改写后检索 Query 过短，可能丢失关键语义约束');
        suggestions.push('建议调优 Agent 的意图改写 Prompt 或降低意图模型泛化改写力度');
      }
    }
  }

  // RAG 召回与 Rerank 过滤诊断
  if (ragStage && ragStage.data) {
    const rdata = ragStage.data;
    const selectedCount = rdata.selected_count !== undefined ? rdata.selected_count : (rdata.count || 0);
    const obs = rdata.retrieval_observability || {};
    const initCandidates = obs.initial_candidates || 0;
    const droppedSources = rdata.dropped_sources || [];
    const droppedCount = rdata.dropped_count || droppedSources.length;

    if (selectedCount === 0) {
      healthLevel = 'danger';
      if (initCandidates === 0) {
        issues.push('<strong>初检索零召回：</strong>初筛候选切片为 0，知识库未命中任何相关文档');
        suggestions.push('1. 检查知识库文件状态与向量/ES索引构建情况；2. 适当调大初筛 TopK；3. 检查提问中是否存在无对应切片的冷僻专有名词');
      } else {
        issues.push('<strong>Rerank 重排强截断：</strong>初筛命中 ' + initCandidates + ' 条候选切片，但重排后全部被过滤（0 条入选）');
        suggestions.push('1. 检查 Agent 的 Rerank 最低相似度阈值配置（当前阈值可能过高）；2. 查看下方【被淘汰切片】确认切片质量；3. 评估更换更匹配业务领域的重排模型');
      }
    } else {
      if (droppedCount > 0 && (selectedCount / (selectedCount + droppedCount)) <= 0.25 && droppedCount >= 6) {
        if (healthLevel !== 'danger') healthLevel = 'warning';
        issues.push('<strong>重排候选淘汰率较高：</strong>初筛后共有 ' + droppedCount + ' 条切片被淘汰，仅保留 ' + selectedCount + ' 条');
        suggestions.push('请展开下方【被淘汰切片】卡片排查是否有核心依据切片被误杀；若存在误杀可调低相似度阈值');
      }
      // 重排相关性阈值模式（自适应注入）下，命中少量高相关切片属正常设计，不告警
      if (selectedCount < 2 && !(d.search_config && d.search_config.rerank_score_threshold_enabled)) {
        if (healthLevel === 'good') healthLevel = 'warning';
        issues.push('<strong>参考上下文偏少（仅 ' + selectedCount + ' 条切片）：</strong>可能影响多段落综合答复的完整度');
        suggestions.push('可在 Agent 配置中适当调高最终 TopK 数量');
      }
    }
  }

  // LLM 回答质量诊断
  if (llmStage && llmStage.data) {
    const ldata = llmStage.data;
    const resp = (ldata.response || '').trim();
    if (ragStage && ragStage.data && (ragStage.data.selected_count || ragStage.data.count) > 0) {
      if (resp.includes('无法回答') || resp.includes('未提及') || resp.includes('不知道') || resp.includes('没有提供') || resp.includes('未能找到')) {
        if (healthLevel !== 'danger') healthLevel = 'warning';
        issues.push('<strong>答复未能采纳知识：</strong>检测到回答中包含拒答或“未提及”表述');
        suggestions.push('1. 对照下方【入选切片】确认检索内容是否能支撑回答；2. 若切片有答案但大模型未参考，建议检查 Prompt 中对知识约束的强硬程度');
      }
    }
  }

  let headerBg = 'rgba(67, 209, 154, 0.15)';
  let borderColor = 'var(--green)';
  let titleIcon = '🟢';
  let titleText = '链路质量健康 · 诊断完成';

  if (healthLevel === 'danger') {
    headerBg = 'rgba(255, 111, 145, 0.15)';
    borderColor = 'var(--red)';
    titleIcon = '🔴';
    titleText = '调优诊断 Copilot · 发现严重问题/零召回';
  } else if (healthLevel === 'warning') {
    headerBg = 'rgba(244, 201, 93, 0.15)';
    borderColor = 'var(--yellow)';
    titleIcon = '🟡';
    titleText = '调优诊断 Copilot · 发现可优化项';
  }

  let bodyHtml = '';
  if (issues.length) {
    bodyHtml += '<div style="margin-bottom:10px;"><strong>⚠️ 根因排查定位：</strong><ul style="margin:6px 0 10px 20px;padding:0;color:#cbd5e1;line-height:1.6;">' +
      issues.map(it => '<li>' + it + '</li>').join('') +
      '</ul></div>';
  }
  if (suggestions.length) {
    bodyHtml += '<div><strong style="color:var(--blue);">💡 推荐调优行动建议：</strong><ul style="margin:6px 0 0 20px;padding:0;color:#94a3b8;line-height:1.6;">' +
      suggestions.map(it => '<li>' + it + '</li>').join('') +
      '</ul></div>';
  }
  if (!issues.length && !suggestions.length) {
    bodyHtml = '<div style="color:#cbd5e1;">全链路意图识别、多路召回、重排分值分布与提示词推理均正常闭环，指标健康。</div>';
  }

  return '<div class="stage-card" style="border-left:4px solid ' + borderColor + ';margin-bottom:16px;">' +
    '<div class="stage-header" style="background:' + headerBg + ';">' +
      '<span class="stage-title" style="color:#fff;">' + titleIcon + ' ' + titleText + '</span>' +
      '<span class="badge ' + (healthLevel === 'good' ? 'success' : (healthLevel === 'warning' ? 'yellow' : 'failed')) + '">调优助手</span>' +
    '</div>' +
    '<div class="stage-body" style="font-size:13px;">' + bodyHtml + '</div>' +
  '</div>';
}
function renderStageCard(st, idx, t) {
  const d = st.data || {};
  let titleBadge = '';
  if (st.stage === 'intent') titleBadge = '<span class="badge yellow">意图与范围</span>';
  else if (st.stage === 'rag') titleBadge = '<span class="badge purple">知识库召回</span>';
  else if (st.stage === 'tool') titleBadge = '<span class="badge tag">工具执行</span>';
  else if (st.stage === 'llm') {
    titleBadge = d.is_refusal
      ? '<span class="badge failed" style="background:#ef4444;color:#fff;">⚠️ 拒答回复</span>'
      : '<span class="badge success">模型生成</span>';
  }

  let body = '';
  if (st.stage === 'intent') {
    const displayOrigQuery = d.original_query || (t && t.original_query) || '';
    if (displayOrigQuery) {
      body += '<div class="prop-row" style="background:#070d18;padding:10px 14px;border-radius:8px;margin-bottom:12px;border-left:4px solid var(--blue);">' +
        '<div class="prop-key" style="color:var(--blue);font-weight:bold;font-size:13px;min-width:100px;">用户原始问题：</div>' +
        '<div class="prop-val" style="font-size:14px;font-weight:600;color:#f8fafc;line-height:1.5;word-break:break-all;">' + esc(displayOrigQuery) + '</div>' +
      '</div>';
    }

    if (d.intent === 'CHITCHAT' || d.answer) {
      const refusalAnswer = d.answer || (t && t.response) || '（已触发固定拒答文案或超纲阻断）';
      body += '<div style="margin-bottom:14px;padding:12px 16px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
          '<span style="font-weight:bold;color:var(--red);font-size:14px;">⚠️ 触发拒答流程</span>' +
          '<span class="badge failed" style="background:#ef4444;color:#fff;font-weight:bold;">命中闲聊 / 超纲拒答</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px;"><strong>拒答回复内容：</strong></div>' +
        '<div style="padding:10px 12px;background:#0b1424;border-radius:6px;color:#fca5a5;font-size:13px;line-height:1.6;white-space:pre-wrap;border:1px solid rgba(239,68,68,0.25);">' + esc(refusalAnswer) + '</div>' +
      '</div>';
    }

    if (d.original_query && d.normalized_query && d.original_query !== d.normalized_query) {
      body += '<div style="margin-bottom:12px;padding:10px 12px;background:#070d18;border:1px solid #1e293b;border-radius:8px;">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:4px;"><strong>Query 改写对比（原问题 vs 检索Query）：</strong></div>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;">' +
          '<div style="flex:1;min-width:180px;"><span style="color:var(--muted);">原问题:</span> ' + esc(d.original_query) + '</div>' +
          '<div style="color:var(--yellow);font-weight:bold;">➔</div>' +
          '<div style="flex:1;min-width:180px;"><span style="color:var(--blue);">检索Query:</span> <strong>' + esc(d.normalized_query) + '</strong></div>' +
        '</div>' +
      '</div>';
    }
    body += '<div class="prop-row"><div class="prop-key">命中意图：</div><div class="prop-val"><span class="badge yellow">' + esc(d.intent || '-') + '</span> ' + (d.skill_name ? ('命中技能: <strong>' + esc(d.skill_name) + '</strong>') : '') + '</div></div>';
    if (d.history_turns) body += '<div class="prop-row"><div class="prop-key">历史上下文：</div><div class="prop-val"><span class="badge tag">结合前序 ' + d.history_turns + ' 轮对话改写</span></div></div>';
    if (d.confidence !== undefined) body += '<div class="prop-row"><div class="prop-key">置信度：</div><div class="prop-val">' + (d.confidence || 0) + '</div></div>';
    if (d.reasoning) body += '<div class="prop-row"><div class="prop-key">分类原因：</div><div class="prop-val" style="color:#cbd5e1;">' + esc(d.reasoning) + '</div></div>';
    if (d.normalized_query && (!d.original_query || d.original_query === d.normalized_query)) body += '<div class="prop-row"><div class="prop-key">改写后查询：</div><div class="prop-val" style="color:var(--blue);">' + esc(d.normalized_query) + '</div></div>';
    if (d.keywords && d.keywords.length) {
      body += '<div class="prop-row"><div class="prop-key">提取关键词：</div><div class="prop-val tag-list">' +
        d.keywords.map(k => '<span class="badge tag">' + esc(k) + '</span>').join('') + '</div></div>';
    }
    if (d.expanded_queries && d.expanded_queries.length) {
      body += '<div class="prop-row"><div class="prop-key">拆解子查询：</div><div class="prop-val">' +
        d.expanded_queries.map((q, i) => '<div>' + (i+1) + '. ' + esc(q) + '</div>').join('') + '</div></div>';
    }
    if (d.candidate_skills) {
      body += '<div class="prop-row"><div class="prop-key">候选技能池：</div><div class="prop-val"><pre class="code-block" style="max-height:120px;">' + esc(JSON.stringify(d.candidate_skills, null, 2)) + '</pre></div></div>';
    }
  } else if (st.stage === 'rag') {
    const selectedCount = d.selected_count !== undefined ? d.selected_count : (d.count || 0);
    body += '<div class="prop-row"><div class="prop-key">检索关键词：</div><div class="prop-val" style="color:var(--blue);font-weight:bold;">' + esc(d.query || '-') + '</div></div>';
    body += '<div class="prop-row"><div class="prop-key">送入大模型切片：</div><div class="prop-val"><strong style="color:var(--green);font-size:15px;">' + selectedCount + ' 条</strong> <span style="font-size:12px;color:var(--muted);">（最终注入 Prompt 作为推理参考上下文）</span></div></div>';

    // 检索配置快照
    const scfg = d.search_config;
    if (scfg) {
      const cparts = [];
      if (scfg.top_k) cparts.push('TopK: <strong>' + scfg.top_k + '</strong>');
      if (scfg.rerank_enabled !== undefined) {
        cparts.push(scfg.rerank_enabled ? '<span class="badge purple">Rerank已开启</span>' : '<span class="badge tag">Rerank未开启</span>');
      }
      if (scfg.rerank_model) cparts.push('重排模型: <strong>' + esc(scfg.rerank_model) + '</strong>');
      if (scfg.score_threshold_enabled && scfg.score_threshold) {
        cparts.push('最低阈值: <strong>' + scfg.score_threshold + '</strong>');
      }
      if (cparts.length) {
        body += '<div class="prop-row"><div class="prop-key">检索配置快照：</div><div class="prop-val" style="font-size:12px;color:#cbd5e1;">' + cparts.join(' · ') + '</div></div>';
      }
      if (scfg.rerank_execution_status) {
        let statusBadge = '';
        if (scfg.rerank_execution_status === 'success') {
          statusBadge = '<span class="badge green">✅ Rerank 接口调用成功</span>';
        } else if (scfg.rerank_execution_status === 'failed') {
          statusBadge = '<span class="badge failed">❌ Rerank 调用失败已降级</span>';
        } else {
          statusBadge = '<span class="badge tag">⏭️ 未启用重排接口</span>';
        }
        body += '<div class="prop-row"><div class="prop-key">重排接口执行：</div><div class="prop-val" style="font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          statusBadge +
          '<span style="color:#cbd5e1;">' + esc(scfg.rerank_execution_desc || '') + '</span>' +
        '</div></div>';
      }
      if (scfg.retrieval_queries && scfg.retrieval_queries.length > 1) {
        body += '<div class="prop-row"><div class="prop-key">多问题初筛召回：</div><div class="prop-val" style="font-size:12px;">' +
          '<div style="color:var(--yellow);margin-bottom:4px;">💡 意图识别扩展了 ' + scfg.retrieval_queries.length + ' 个子查询，每个问题均向知识库发起独立召回并合并，因此初筛产生了较多候选切片：</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
            scfg.retrieval_queries.map((q, qi) => '<span class="badge tag" style="background:#1e293b;border:1px solid #475569;">Q' + (qi+1) + ': ' + esc(q) + '</span>').join('') +
          '</div>' +
        '</div></div>';
      }
    }

    const obs = d.retrieval_observability;
    if (obs) {
      body += '<div class="prop-row"><div class="prop-key">多路召回漏斗：</div><div class="prop-val" style="font-size:12px;color:#cbd5e1;">';
      const parts = [];
      if (obs.initial_candidates !== undefined) parts.push('初筛候选: <strong>' + obs.initial_candidates + '</strong> 条');
      if (obs.after_rerank !== undefined) parts.push('重排后: <strong>' + obs.after_rerank + '</strong> 条');
      parts.push('最终入选: <strong style="color:var(--green);">' + selectedCount + '</strong> 条');
      body += parts.join(' ➔ ') + '</div></div>';
    }

    if (d.search_errors && d.search_errors.length) {
      body += '<div class="prop-row"><div class="prop-key">检索异常：</div><div class="prop-val" style="color:var(--red);">' + esc(d.search_errors.join('; ')) + '</div></div>';
    }

    const sources = d.sources || [];
    if (sources.length) {
      body += '<div style="margin-top:14px;margin-bottom:8px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">' +
        '<span>入选大模型提示词上下文的切片详情（按相关度排序）：</span>' +
        '<span style="font-size:12px;color:var(--muted);">共 ' + sources.length + ' 个切片</span>' +
      '</div>';
      body += '<div style="margin-top:8px;">' + sources.map(s => {
        let typeBadge = '';
        const stype = (s.source_type || '').toLowerCase();
        if (stype === 'wiki') {
          typeBadge = '<span class="badge green" title="来自 Wiki 知识页面">📖 Wiki 文档</span>';
        } else if (stype === 'graph') {
          typeBadge = '<span class="badge purple" title="来自知识图谱实体与关联聚合">🕸️ 知识图谱</span>';
        } else if (stype === 'web') {
          typeBadge = '<span class="badge yellow" title="来自联网搜索结果">🌐 网络搜索</span>';
        } else {
          typeBadge = '<span class="badge blue" title="来自知识库向量或全文检索文件">📁 RAG 文件</span>';
        }

        let chunkTypeBadge = '';
        if (s.chunk_type && s.chunk_type !== 'document' && s.chunk_type !== 'file' && s.chunk_type !== stype) {
          if (s.chunk_type === 'qa' || s.chunk_type === 'faq') {
            chunkTypeBadge = ' <span class="badge yellow">问答对</span>';
          } else {
            chunkTypeBadge = ' <span class="badge tag">' + esc(s.chunk_type) + '</span>';
          }
        }

        let displayName = (s.file_name || s.title || '').trim();
        if (!displayName && s.file_path) {
          displayName = s.file_path.split('/').pop();
        }
        if (!displayName) {
          if (stype === 'wiki') displayName = 'Wiki 知识页面';
          else if (stype === 'graph') displayName = '知识图谱实体关联';
          else if (stype === 'web') displayName = s.url ? esc(s.url) : '网络检索摘要';
          else if (s.file_id) displayName = '知识库文档 (ID: ' + s.file_id + ')';
          else displayName = '知识库切片';
        }

        let locationBadges = '';
        if (s.knowledge_base_name || s.library_name) {
          locationBadges += ' <span class="badge tag" style="background:rgba(255,255,255,0.06);color:#94a3b8;">库: ' + esc(s.knowledge_base_name || s.library_name) + '</span>';
        }
        if (s.space_name) {
          locationBadges += ' <span class="badge tag" style="background:rgba(255,255,255,0.06);color:#94a3b8;">空间: ' + esc(s.space_name) + '</span>';
        }

        // 排名变化
        let rankShiftBadge = '';
        if (s.source_rank && s.source_rank > 0) {
          const shift = s.source_rank - s.index;
          if (shift > 0) {
            rankShiftBadge = ' <span class="badge rank-up" title="初检索第 ' + s.source_rank + ' 位，Rerank后升至第 ' + s.index + ' 位">↑+' + shift + '</span>';
          } else if (shift < 0) {
            rankShiftBadge = ' <span class="badge rank-down" title="初检索第 ' + s.source_rank + ' 位，Rerank后降至第 ' + s.index + ' 位">↓' + shift + '</span>';
          } else {
            rankShiftBadge = ' <span class="badge tag" title="初检索第 ' + s.source_rank + ' 位，位次持平">=</span>';
          }
        }

        let scoreDetails = [];
        if (s.score !== undefined && s.score !== null) {
          scoreDetails.push('Rerank终分: <strong style="color:var(--green);">' + s.score.toFixed(4) + '</strong>');
        }
        if (s.raw_score !== undefined && s.raw_score !== null && s.raw_score > 0) {
          scoreDetails.push('初检分: ' + s.raw_score.toFixed(4));
        } else if (s.fusion_score) {
          scoreDetails.push('融合分: ' + s.fusion_score.toFixed(4));
        }

        return '<div class="source-card">' +
          '<div class="source-header">' +
            '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">' +
              '<strong style="color:#f8fafc;">#' + s.index + ' ' + esc(displayName) + '</strong>' +
              typeBadge +
              chunkTypeBadge +
              rankShiftBadge +
              locationBadges +
            '</div>' +
            '<div class="source-score" style="white-space:nowrap;margin-left:8px;font-size:12px;">' + scoreDetails.join(' · ') + '</div>' +
          '</div>' +
          '<div class="source-content">' + esc(s.content) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    } else {
      body += '<div class="muted" style="margin-top:8px;">无相关切片被召回入选</div>';
    }

    // 被淘汰切片列表
    const dropped = d.dropped_sources || [];
    if (dropped.length > 0) {
      const toggleId = 'dropped_panel_' + idx;
      const rerankDropCause = (scfg && scfg.rerank_score_threshold_enabled && scfg.rerank_score_threshold > 0)
        ? '重排相关性分低于阈值 <strong>' + scfg.rerank_score_threshold + '</strong> 或排名超出 TopK'
        : '分数排在 TopK 之后';
      const rerankSortDesc = (scfg && scfg.rerank_execution_status === 'success')
        ? ('经由 <strong>' + esc(scfg.rerank_model || 'Rerank') + '</strong> 模型重排序打分，' + rerankDropCause + '而被过滤')
        : '未启用重排，按初筛检索相似度/相关度排序，排在 TopK 之后而被截断';
      body += '<div style="margin-top:16px;border:1px dashed #334155;border-radius:10px;padding:12px;background:rgba(15,23,42,0.5);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleDropped(\'' + toggleId + '\')">' +
          '<div style="font-weight:600;color:var(--yellow);font-size:13px;display:flex;align-items:center;gap:6px;">' +
            '<span>⚠️ 被淘汰的候选切片 (' + dropped.length + ' 条)</span>' +
            '<span style="font-size:12px;color:var(--muted);font-weight:normal;">点击展开/折叠排查是否存在核心知识误过滤</span>' +
          '</div>' +
          '<span class="badge tag" style="cursor:pointer;">展开/收起</span>' +
        '</div>' +
        '<div id="' + toggleId + '" style="display:none;margin-top:12px;">' +
          '<div style="background:#0f172a;border-left:3px solid var(--yellow);padding:8px 12px;border-radius:4px;margin-bottom:10px;font-size:12px;color:#94a3b8;">' +
            '📌 <strong>淘汰与排序逻辑说明：</strong>' + rerankSortDesc + '。若此处包含更符合问题的关键切片，说明阈值设置过高或重排模型给分偏差。' +
          '</div>' +
          dropped.map((ds, di) => {
            const droppedScoreParts = [];
            if (ds.score !== undefined && ds.score !== null && ds.raw_score !== undefined && ds.raw_score !== null && ds.score !== ds.raw_score) {
              droppedScoreParts.push('重排分: <strong style="color:var(--yellow);">' + ds.score.toFixed(4) + '</strong>');
            }
            if (ds.raw_score) droppedScoreParts.push('初检分: ' + ds.raw_score.toFixed(4));
            return '<div class="source-card" style="opacity:0.85;border-color:#263752;background:#0b1424;margin-bottom:8px;">' +
              '<div class="source-header">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<strong style="color:#94a3b8;">#' + (di+1) + ' ' + esc(ds.file_name || ds.title || '知识库切片') + '</strong>' +
                  '<span class="badge failed">' + esc(ds.reason || '已淘汰') + '</span>' +
                  (ds.source_rank ? ('<span class="badge tag">初检第 ' + ds.source_rank + ' 位</span>') : '') +
                '</div>' +
                '<div style="font-size:12px;color:var(--muted);">' + droppedScoreParts.join(' · ') + '</div>' +
              '</div>' +
              '<div class="source-content" style="color:#64748b;font-size:11px;max-height:90px;">' + esc(ds.content) + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }
  } else if (st.stage === 'tool') {
    body += '<div class="prop-row"><div class="prop-key">工具名称：</div><div class="prop-val"><strong>' + esc(d.tool_name || '-') + '</strong></div></div>';
    if (d.arguments) {
      body += '<div class="prop-row"><div class="prop-key">调用参数：</div><div class="prop-val"><pre class="code-block">' + esc(typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments, null, 2)) + '</pre></div></div>';
    }
    if (d.result) {
      body += '<div class="prop-row"><div class="prop-key">工具返回：</div><div class="prop-val"><pre class="code-block">' + esc(typeof d.result === 'string' ? d.result : JSON.stringify(d.result, null, 2)) + '</pre></div></div>';
    }
  } else if (st.stage === 'llm') {
    body += '<div class="prop-row"><div class="prop-key">调用模型：</div><div class="prop-val"><span class="badge tag">' + esc(d.model || '-') + '</span></div></div>';
    if (d.params) {
      const p = d.params;
      const pList = [];
      if (p.temperature !== undefined) pList.push('Temperature: ' + p.temperature);
      if (p.top_p !== undefined) pList.push('TopP: ' + p.top_p);
      if (p.max_tokens !== undefined && p.max_tokens > 0) pList.push('MaxTokens: ' + p.max_tokens);
      if (p.stream !== undefined) pList.push('Stream: ' + p.stream);
      if (pList.length) {
        body += '<div class="prop-row"><div class="prop-key">生成超参：</div><div class="prop-val" style="font-size:12px;color:#cbd5e1;">' + pList.join(' · ') + '</div></div>';
      }
    }
    if (d.is_refusal) {
      body += '<div style="margin-bottom:14px;padding:12px 16px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
          '<span style="font-weight:bold;color:var(--red);font-size:14px;">⚠️ 触发拒答 / 超纲回复</span>' +
          '<span class="badge failed" style="background:#ef4444;color:#fff;">固定回复/未调用主模型推理</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px;"><strong>拒答回复内容：</strong></div>' +
        '<div style="padding:10px 12px;background:#0b1424;border-radius:6px;color:#fca5a5;font-size:13px;line-height:1.6;white-space:pre-wrap;border:1px solid rgba(239,68,68,0.25);">' + esc(d.refusal_reply || d.response || '-') + '</div>' +
      '</div>';
    }
    body += '<div class="prop-row"><div class="prop-key">Token 消耗：</div><div class="prop-val">Prompt: ' + (d.prompt_tokens || 0) + ' · Completion: ' + (d.completion_tokens || 0) + ' · Total: ' + (d.total_tokens || 0) + '</div></div>';
    if (d.prompt) {
      body += '<div style="margin-top:10px;"><strong>输入提示词 Prompt（组装后）：</strong></div>';
      body += '<pre class="code-block" style="margin-top:6px;">' + esc(typeof d.prompt === 'string' ? d.prompt : JSON.stringify(d.prompt, null, 2)) + '</pre>';
    }
    if (d.response) {
      body += '<div style="margin-top:10px;"><strong>模型实际响应 Response：</strong></div>';
      body += '<pre class="code-block" style="margin-top:6px;color:#d1fae5;">' + esc(d.response) + '</pre>';
    }
  }

  let durationBadge = '';
  if (st.duration_ms !== undefined && st.duration_ms !== null) {
    durationBadge = '<span class="badge" style="background:#1e293b;color:#38bdf8;font-family:monospace;font-size:12px;">耗时: ' + formatDuration(st.duration_ms) + '</span>';
  }
  let timeMeta = '';
  if (st.started_at) {
    timeMeta = '<span style="font-size:12px;color:var(--muted);margin-right:8px;">' + formatTime(st.started_at) + '</span>';
  }

  return '<div class="stage-card">' +
    '<div class="stage-header">' +
      '<div class="stage-title">' + titleBadge + ' <span>' + esc(st.title || st.stage) + '</span></div>' +
      '<div style="display:flex;align-items:center;">' + timeMeta + durationBadge + '</div>' +
    '</div>' +
    '<div class="stage-body">' + body + '</div>' +
  '</div>';
}

function toggleDropped(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleAutoRefresh() {
  const btn = document.getElementById('btnAuto');
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    btn.textContent = '开启自动刷新';
    btn.classList.add('secondary');
  } else {
    autoTimer = setInterval(refreshTraces, 3000);
    btn.textContent = '暂停自动刷新';
    btn.classList.remove('secondary');
  }
}

if (eidInput.value.trim() && tokenInput.value.trim()) {
  setTimeout(refreshTraces, 100);
}
</script>
</body>
</html>
`
