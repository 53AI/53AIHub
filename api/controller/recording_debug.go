package controller

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	"github.com/gin-gonic/gin"
)

// GetRecordingInsightDebugUI godoc
// @Summary 会议纪要与洞察全流程调试页面
// @Description 查看录音转写、会议纪要、记忆、洞察和决策页面的完整生成 Trace
// @Tags SystemLog
// @Produce html
// @Success 200 {string} string "HTML page"
// @Router /api/system_logs/recording_insight_debug/ui [get]
func GetRecordingInsightDebugUI(c *gin.Context) {
	html := strings.Replace(recordingInsightDebugUIHTML, "<!--SYSLOG_NAV-->", SystemLogNavHTML("/api/system_logs/recording_insight_debug/ui"), 1)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// GetRecordingInsightDebugTraces godoc
// @Summary 获取会议纪要与洞察调试 Trace 列表
// @Description 获取指定企业最近的录音生成 Trace
// @Tags SystemLog
// @Produce json
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=[]recordingdebug.TraceSummary}
// @Router /api/system_logs/recording_insight_debug/traces [get]
func GetRecordingInsightDebugTraces(c *gin.Context) {
	eid, ok := parseRecordingInsightDebugEID(c)
	if !ok {
		return
	}
	traces, err := recordingdebug.ListTraces(c.Request.Context(), eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(traces))
}

// GetRecordingInsightDebugTraceDetail godoc
// @Summary 获取会议纪要与洞察调试 Trace 详情
// @Description 获取单次录音生成的所有阶段、最终模型消息和中间结果
// @Tags SystemLog
// @Produce json
// @Param request_id path string true "Trace请求ID"
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=recordingdebug.Trace}
// @Router /api/system_logs/recording_insight_debug/traces/{request_id} [get]
func GetRecordingInsightDebugTraceDetail(c *gin.Context) {
	eid, ok := parseRecordingInsightDebugEID(c)
	if !ok {
		return
	}
	requestID := c.Param("request_id")
	if requestID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("request_id 参数不能为空"))
		return
	}
	trace, err := recordingdebug.GetTraceDetail(context.Background(), eid, requestID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	if trace == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("未找到该 Trace 或已过期"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(trace))
}

func parseRecordingInsightDebugEID(c *gin.Context) (int64, bool) {
	eid, err := strconv.ParseInt(c.Query("eid"), 10, 64)
	if err != nil || eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("eid 参数无效"))
		return 0, false
	}
	return eid, true
}

const recordingInsightDebugUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>会议纪要 · 洞察全流程调试</title>
<style>
:root{--bg:#11100e;--panel:#1b1915;--panel2:#242019;--line:#40382b;--text:#f3ede2;--muted:#a99d89;--amber:#eab55a;--green:#65d6a0;--red:#ff7f78;--blue:#84bfff;--purple:#c6a1ff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -5%,#4b371d 0,#11100e 42%);color:var(--text);font:14px ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif}.shell{max-width:1680px;margin:auto;padding:24px}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}.nav a{text-decoration:none}.nav button,.toolbar button{border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--text);padding:8px 13px;cursor:pointer}.nav button.active{background:#4a3518;border-color:#b8873e;color:#ffe3a2}.top{display:flex;justify-content:space-between;align-items:end;margin-bottom:18px}.eyebrow{color:var(--amber);font-size:11px;letter-spacing:2px;font-weight:700}.top h1{margin:6px 0;font-size:28px}.muted{color:var(--muted)}.toolbar,.panel{background:rgba(27,25,21,.94);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 45px #0006}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:13px;margin-bottom:16px}.toolbar input{background:#12110f;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:9px 11px}.toolbar input:focus{outline:none;border-color:var(--amber)}.toolbar button.primary{background:var(--amber);border-color:var(--amber);color:#211707;font-weight:700}.toolbar button.on{background:#204835;border-color:#3f9e70;color:#d9ffe9}.layout{display:grid;grid-template-columns:390px 1fr;gap:16px;align-items:start}.panel{padding:17px}.panel h2{font-size:16px;margin:0 0 13px;display:flex;justify-content:space-between}.list{display:flex;flex-direction:column;gap:9px;max-height:calc(100vh - 260px);overflow:auto}.filter{width:100%;margin-bottom:11px;background:#12110f;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:9px}.trace{background:#15130f;border:1px solid var(--line);border-radius:10px;padding:12px;cursor:pointer;transition:.16s}.trace:hover,.trace.active{border-color:var(--amber);background:#211a10}.trace-head,.event-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.trace-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trace-meta{margin-top:7px;color:var(--muted);font-size:12px;line-height:1.55}.badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap}.success{color:var(--green)}.failed{color:var(--red)}.running{color:var(--amber)}.skipped{color:var(--muted)}.badge.success{background:#16452f}.badge.failed{background:#542622}.badge.running{background:#503a16}.badge.skipped{background:#37332d}.empty{text-align:center;color:var(--muted);padding:54px 16px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px;margin-bottom:17px}.metric{background:#15130f;border:1px solid var(--line);border-radius:10px;padding:12px}.metric .label{font-size:11px;color:var(--muted)}.metric .value{margin-top:5px;font-size:18px;font-weight:700}.timeline{display:flex;flex-direction:column;gap:10px}.event{border:1px solid var(--line);border-left:3px solid var(--blue);border-radius:10px;background:#15130f;overflow:hidden}.event.failed{border-left-color:var(--red)}.event.skipped{border-left-color:#766e62}.event.processing{border-left-color:var(--amber)}.event-head{padding:12px 14px;background:#211d17;border-bottom:1px solid var(--line)}.event-title{font-weight:700}.event-sub{font-size:12px;color:var(--muted);margin-top:4px}.event-body{padding:13px}.event-body details{margin-top:9px;border-top:1px solid var(--line);padding-top:9px}.event-body summary{cursor:pointer;color:var(--amber)}pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;background:#0c0b0a;border:1px solid #302a20;border-radius:8px;padding:11px;color:#d8d0c2;font:12px ui-monospace,SFMono-Regular,monospace}.error{color:var(--red);white-space:pre-wrap;word-break:break-word}.flow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.flow span{border:1px solid var(--line);border-radius:99px;padding:5px 9px;color:var(--muted);font-size:12px}.flow span.done{color:var(--green);border-color:#347a59}.flow span.active{color:var(--amber);border-color:#a47732}@media(max-width:900px){.shell{padding:14px}.layout{grid-template-columns:1fr}.list{max-height:380px}.top{align-items:start;gap:10px;flex-direction:column}.top h1{font-size:23px}}
</style>
</head>
<body>
<main class="shell">
<!--SYSLOG_NAV-->
<header class="top"><div><div class="eyebrow">RECORDING INSIGHT PIPELINE</div><h1>会议纪要 · 洞察全流程调试</h1><div class="muted">转写输入 → Prompt 2 纪要 → 会议记忆 → 洞察背景 → Prompt 4 → Prompt 5 页面</div></div><div id="updated" class="muted">等待查询</div></header>
<div class="toolbar"><input id="token" type="password" placeholder="FILE_LOG_VIEWER_ACCESS_TOKEN" style="width:270px"><input id="eid" placeholder="企业 ID (EID)" style="width:140px"><button class="primary" onclick="refresh()">刷新列表</button><button id="auto" onclick="toggleAuto()">开启自动刷新</button></div>
<div class="layout"><section class="panel"><h2>最近生成 <span id="count" class="muted"></span></h2><input id="search" class="filter" placeholder="过滤文件名 / Trace / file ID" oninput="renderList()"><div id="list" class="list"><div class="empty">请输入 Token 与企业 ID 后查询</div></div></section><section class="panel"><h2>过程详情 <span id="selected" class="muted"></span></h2><div id="detail"><div class="empty">选择一次生成，查看每个阶段及真实 LLM 消息</div></div></section></div>
</main>
<script>
var token=document.getElementById('token'),eid=document.getElementById('eid'),traces=[],selected='',timer=null;
token.value=localStorage.getItem('recording_debug_token')||'';eid.value=localStorage.getItem('recording_debug_eid')||'';
var params=new URLSearchParams(location.search);if(params.get('token'))token.value=params.get('token');if(params.get('eid'))eid.value=params.get('eid');
token.oninput=function(){localStorage.setItem('recording_debug_token',token.value.trim())};eid.oninput=function(){localStorage.setItem('recording_debug_eid',eid.value.trim())};
function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})}
function headers(){var t=token.value.trim();return t?{'X-Access-Token':t,'Authorization':'Bearer '+t}:{}}
function time(v){if(!v)return '-';return new Date(v).toLocaleTimeString('zh-CN',{hour12:false})}
function duration(v){return v==null?'-':(v/1000).toFixed(2)+'s'}
function statusText(v){return {success:'成功',failed:'失败',running:'进行中',skipped:'跳过',processing:'处理中',degraded:'降级'}[v]||v||'未知'}
function badge(v){return '<span class="badge '+esc(v)+'">'+esc(statusText(v))+'</span>'}
function json(v){try{return JSON.stringify(v,null,2)}catch(e){return String(v)}}
function refresh(){var id=eid.value.trim();if(!id){alert('请输入企业 ID (EID)');return}document.getElementById('updated').textContent='正在刷新...';fetch('/api/system_logs/recording_insight_debug/traces?eid='+encodeURIComponent(id),{headers:headers()}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'HTTP '+r.status);return j})}).then(function(j){traces=j.data||[];document.getElementById('updated').textContent='更新于 '+new Date().toLocaleTimeString();document.getElementById('count').textContent=traces.length+' 条';renderList();if(selected)load(selected);else if(traces[0])select(traces[0].request_id)}).catch(function(e){document.getElementById('updated').textContent='刷新失败';alert('获取 Trace 失败: '+e.message)})}
function renderList(){var q=document.getElementById('search').value.trim().toLowerCase(),list=traces.filter(function(t){return (t.file_name+' '+t.request_id+' '+t.file_id).toLowerCase().indexOf(q)>=0}),el=document.getElementById('list');if(!list.length){el.innerHTML='<div class="empty">暂无符合条件的生成记录</div>';return}el.innerHTML=list.map(function(t){return '<div class="trace '+(t.request_id===selected?'active':'')+'" onclick="select(\''+esc(t.request_id)+'\')"><div class="trace-head"><div class="trace-name">'+esc(t.file_name||('文件 '+t.file_id))+'</div>'+badge(t.status)+'</div><div class="trace-meta">Trace '+esc(t.request_id)+'<br>代次 '+esc(t.generation)+' · '+time(t.started_at)+' · '+duration(t.duration_ms)+' · '+t.stage_count+' 个阶段</div></div>'}).join('')}
function select(id){selected=id;renderList();load(id)}
function load(id){var el=document.getElementById('detail');document.getElementById('selected').textContent=id;el.innerHTML='<div class="empty">加载中...</div>';fetch('/api/system_logs/recording_insight_debug/traces/'+encodeURIComponent(id)+'?eid='+encodeURIComponent(eid.value.trim()),{headers:headers()}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'HTTP '+r.status);return j})}).then(function(j){renderDetail(j.data)}).catch(function(e){el.innerHTML='<div class="empty failed">加载失败: '+esc(e.message)+'</div>'})}
function renderDetail(t){var stages=t.stages||[],done=stages.filter(function(s){return s.status==='success'}).length,html='<div class="metrics"><div class="metric"><div class="label">文件</div><div class="value" style="font-size:14px">'+esc(t.file_name||t.file_id)+'</div></div><div class="metric"><div class="label">整体状态</div><div class="value">'+badge(t.status)+'</div></div><div class="metric"><div class="label">总耗时</div><div class="value">'+duration(t.duration_ms)+'</div></div><div class="metric"><div class="label">阶段完成</div><div class="value">'+done+' / '+stages.length+'</div></div></div><div class="flow"><span class="done">转写输入</span><span class="'+(stages.some(function(s){return s.stage.indexOf('meeting_minutes')===0})?'done':'')+'">Prompt 2 纪要</span><span class="'+(stages.some(function(s){return s.stage==='memory_compile'})?'done':'')+'">会议记忆</span><span class="'+(stages.some(function(s){return s.stage.indexOf('insight')===0})?'done':'')+'">洞察</span><span class="'+(stages.some(function(s){return s.stage==='insight_page'})?'done':'')+'">页面</span></div><div class="timeline">';
stages.forEach(function(s){var data=s.data||{},details='';if(Object.keys(data).length)details='<details><summary>查看阶段数据</summary><pre>'+esc(json(data))+'</pre></details>';html+='<article class="event '+esc(s.status)+'"><div class="event-head"><div><div class="event-title">'+esc(s.title||s.stage)+' '+badge(s.status)+'</div><div class="event-sub">'+esc(s.stage)+' · '+time(s.started_at)+' · '+duration(s.duration_ms)+'</div></div></div><div class="event-body">'+(s.error?'<div class="error">'+esc(s.error)+'</div>':'')+details+'</div></article>'});html+='</div>';if(t.error)html='<div class="error" style="margin-bottom:12px">'+esc(t.error)+'</div>'+html;document.getElementById('detail').innerHTML=html}
function toggleAuto(){var b=document.getElementById('auto');if(timer){clearInterval(timer);timer=null;b.textContent='开启自动刷新';b.classList.remove('on')}else{refresh();timer=setInterval(refresh,5000);b.textContent='关闭自动刷新';b.classList.add('on')}}
if(eid.value&&token.value)refresh();
</script>
</body></html>`
