package controller

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type WikiGenerationStatsResponse struct {
	TodayEvents      int64                                       `json:"today_events"`
	Succeeded        int64                                       `json:"succeeded"`
	Failed           int64                                       `json:"failed"`
	AvgDurationMs    int64                                       `json:"avg_duration_ms"`
	LLMCalls         int64                                       `json:"llm_calls"`
	PromptTokens     int64                                       `json:"prompt_tokens"`
	CompletionTokens int64                                       `json:"completion_tokens"`
	TotalTokens      int64                                       `json:"total_tokens"`
	Candidates       int64                                       `json:"candidates"`
	Entities         int64                                       `json:"entities"`
	Concepts         int64                                       `json:"concepts"`
	CategoryMatched  int64                                       `json:"category_matched"`
	PagesSucceeded   int64                                       `json:"pages_succeeded"`
	PagesFailed      int64                                       `json:"pages_failed"`
	Phases           map[string]service.WikiGenerationPhaseStats `json:"phases"`
	CategoryMatches  map[string]int64                            `json:"category_matches"`
	RecentFailures   []WikiGenerationFailureView                 `json:"recent_failures"`
	ActiveJobs       []map[string]interface{}                    `json:"active_jobs"`
}

type WikiGenerationFailureView struct {
	Time     int64  `json:"time"`
	FileID   string `json:"file_id"`
	JobID    string `json:"job_id"`
	Phase    string `json:"phase"`
	Category string `json:"category,omitempty"`
	Slug     string `json:"slug,omitempty"`
	Error    string `json:"error"`
}

// GetWikiGenerationUI godoc
// @Summary Wiki生成可观测页面
// @Description Wiki生成实时调试页面，仅展示Wiki生成阶段、模型调用、分类匹配和页面保存结果
// @Tags SystemLog
// @Produce html
// @Success 200 {string} string "HTML page"
// @Router /api/system_logs/wiki_generation/ui [get]
func GetWikiGenerationUI(c *gin.Context) {
	html := strings.Replace(wikiGenerationUIHTML, `<main class="shell">`, `<main class="shell"><!--SYSLOG_NAV-->`, 1)
	html = strings.Replace(html, "<!--SYSLOG_NAV-->", SystemLogNavHTML("/api/system_logs/wiki_generation/ui"), 1)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// GetWikiGenerationStats godoc
// @Summary Wiki生成可观测统计
// @Description 获取最近24小时的Wiki生成统计、分类结果和失败详情（仅 FILE_LOG_VIEWER_ACCESS_TOKEN）
// @Tags SystemLog
// @Produce json
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=WikiGenerationStatsResponse}
// @Failure 400 {object} model.CommonResponse
// @Router /api/system_logs/wiki_generation/stats [get]
func GetWikiGenerationStats(c *gin.Context) {
	eid, err := strconv.ParseInt(c.Query("eid"), 10, 64)
	if err != nil || eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(fmt.Errorf("eid 参数无效")))
		return
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(emptyWikiGenerationStats()))
		return
	}
	snapshot, err := service.LoadWikiGenerationObservation(context.Background(), eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	resp := emptyWikiGenerationStats()
	resp.TodayEvents = snapshot.Stats["events"]
	resp.Succeeded = snapshot.Stats["succeeded"]
	resp.Failed = snapshot.Stats["failed"]
	resp.AvgDurationMs = averageWikiGenerationDuration(snapshot.Stats["duration_ms"], resp.TodayEvents)
	resp.LLMCalls = snapshot.Stats["llm_calls"]
	resp.PromptTokens = snapshot.Stats["prompt_tokens"]
	resp.CompletionTokens = snapshot.Stats["completion_tokens"]
	resp.TotalTokens = snapshot.Stats["total_tokens"]
	resp.Candidates = snapshot.Stats["candidates"]
	resp.Entities = snapshot.Stats["entities"]
	resp.Concepts = snapshot.Stats["concepts"]
	resp.CategoryMatched = snapshot.Stats["category_matched"]
	resp.PagesSucceeded = snapshot.Stats["pages_succeeded"]
	resp.PagesFailed = snapshot.Stats["pages_failed"]
	resp.Phases = snapshot.Phases
	resp.CategoryMatches = snapshot.CategoryMatches
	resp.RecentFailures = make([]WikiGenerationFailureView, 0, len(snapshot.Failures))
	for _, failure := range snapshot.Failures {
		resp.RecentFailures = append(resp.RecentFailures, WikiGenerationFailureView{Time: failure.Time, FileID: encodeWikiID(failure.FileID), JobID: encodeWikiID(failure.JobID), Phase: failure.Phase, Category: failure.Category, Slug: failure.Slug, Error: failure.Error})
	}
	resp.ActiveJobs = encodeWikiActiveJobs(snapshot.Active)
	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

func emptyWikiGenerationStats() WikiGenerationStatsResponse {
	return WikiGenerationStatsResponse{Phases: map[string]service.WikiGenerationPhaseStats{}, CategoryMatches: map[string]int64{}, RecentFailures: []WikiGenerationFailureView{}, ActiveJobs: []map[string]interface{}{}}
}

func averageWikiGenerationDuration(total, events int64) int64 {
	if events <= 0 {
		return 0
	}
	return total / events
}

func encodeWikiID(id int64) string {
	if id <= 0 {
		return ""
	}
	encoded, err := hashids.Encode(id)
	if err != nil {
		return ""
	}
	return encoded
}

func encodeWikiActiveJobs(active []map[string]interface{}) []map[string]interface{} {
	for _, job := range active {
		for _, key := range []string{"file_id", "job_id"} {
			if value, ok := job[key].(float64); ok {
				job[key] = encodeWikiID(int64(value))
			}
		}
	}
	return active
}

const wikiGenerationUIHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wiki 生成链路</title>
<style>
:root{--bg:#0b1220;--panel:#111c2f;--panel2:#17243a;--line:#263752;--text:#e7edf7;--muted:#91a0b8;--blue:#63a4ff;--green:#43d19a;--red:#ff6f91;--yellow:#f4c95d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#17335c 0,#0b1220 42%);color:var(--text);font:14px Inter,system-ui,sans-serif;min-height:100vh}.shell{max-width:1500px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:22px}.eyebrow{color:var(--blue);font-size:12px;letter-spacing:2px;text-transform:uppercase}.top h1{margin:5px 0;font-size:28px}.muted{color:var(--muted)}.toolbar,.panel,.metric{background:rgba(17,28,47,.9);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 35px #0003}.toolbar{display:flex;gap:10px;padding:14px;margin-bottom:16px}.toolbar input,.toolbar select,.toolbar button{background:#0d1728;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.toolbar input{min-width:210px}.toolbar button{cursor:pointer;background:#1e66c7;border-color:#3486ee}.layout{display:grid;grid-template-columns:430px 1fr;gap:16px}.panel{padding:16px;min-height:620px}.panel h2{font-size:15px;margin:0 0 14px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.metric{padding:13px}.metric .label{color:var(--muted);font-size:12px}.metric .value{font-size:22px;font-weight:700;margin-top:5px}.files{display:flex;flex-direction:column;gap:8px;max-height:560px;overflow:auto}.file{background:var(--panel2);border:1px solid transparent;border-radius:10px;padding:12px;cursor:pointer}.file:hover,.file.active{border-color:var(--blue)}.file-head{display:flex;justify-content:space-between;gap:8px}.file-title{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{font-size:11px;padding:3px 7px;border-radius:99px;background:#28415c;color:var(--blue)}.badge.success{background:#124c3f;color:var(--green)}.badge.failed{background:#55243a;color:var(--red)}.file-meta{color:var(--muted);font-size:12px;margin-top:8px}.empty{color:var(--muted);padding:35px;text-align:center;border:1px dashed var(--line);border-radius:10px}.detail-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px}.detail-head h2{margin:0 0 5px}.timeline{position:relative;padding-left:22px}.timeline:before{content:"";position:absolute;left:5px;top:7px;bottom:7px;width:2px;background:var(--line)}.event{position:relative;margin:0 0 14px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px}.event:before{content:"";position:absolute;left:-22px;top:15px;width:10px;height:10px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 4px var(--bg)}.event.failed:before{background:var(--red)}.event.success:before{background:var(--green)}.event-top{display:flex;justify-content:space-between;gap:8px}.event-title{font-weight:650}.event-time{color:var(--muted);font-size:12px}.event-body{margin-top:8px;color:var(--muted);line-height:1.6}.event-body strong{color:var(--text)}.event pre{background:#0b1424;color:#b9d5ff;padding:10px;border-radius:7px;overflow:auto;max-height:260px;font-size:12px}.error{color:var(--red)}@media(max-width:1000px){.layout{grid-template-columns:1fr}.panel{min-height:auto}.metrics{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">REALTIME OBSERVABILITY</div><h1>Wiki 生成链路</h1><div class="muted">文件级追踪 · 阶段事件 · 中间结果 · 最近 24 小时</div></div><div id="updated" class="muted">等待加载</div></header>
<div class="toolbar"><input id="token" type="password" placeholder="FILE_LOG_VIEWER_ACCESS_TOKEN"><input id="eid" placeholder="企业 ID"><select id="status"><option value="">全部状态</option><option value="running">进行中</option><option value="success">成功</option><option value="failed">失败</option></select><button onclick="refreshAll()">刷新数据</button></div>
<div class="layout"><section class="panel"><h2>最近文件 <span id="fileCount" class="muted"></span></h2><input id="search" placeholder="搜索文件名 / Trace ID" style="width:100%;margin-bottom:10px;background:#0d1728;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px 12px"><div id="files" class="files"><div class="empty">输入 Token 和企业 ID 后加载</div></div></section>
<section class="panel"><div id="detail"><div class="empty">选择左侧文件查看完整生成链路</div></div></section></div></main>
<style>.phase-explanation{color:var(--muted);background:#0d1728;border-left:3px solid var(--blue);padding:8px 10px;border-radius:5px;margin-bottom:8px;line-height:1.5}.phase-explanation strong{color:var(--text)}</style><script>
const phaseDescriptions={process:'任务总览：负责组织本次 Wiki 生成并决定是否继续后续阶段。',llm:'模型调用：调用大模型提取候选、判断分类或生成页面正文。',candidate_extract:'候选提取：从文档中提取实体和概念，并整理成候选词条。',strict_filter:'严格模式过滤：根据启用分类和系统规则筛掉不属于当前范围的词条。',category_match:'分类匹配：判断候选是否命中启用的 Wiki 分类。',page_generation:'页面生成：根据候选和分类模板生成 Wiki 页面正文。',fixed_structure:'固定结构校验：检查并规范模型输出是否符合分类模板。',page_save:'页面保存：将校验后的 Wiki 页面写入数据库。'};const phaseExplainObserver=new MutationObserver(()=>{document.querySelectorAll('.event').forEach(event=>{if(event.querySelector('.phase-explanation'))return;const phase=event.querySelector('.event-title')?.textContent.trim().split(' ')[0];const text=phaseDescriptions[phase];if(!text)return;const box=document.createElement('div');box.className='phase-explanation';box.innerHTML='<strong>阶段说明：</strong>'+text;event.querySelector('.event-body')?.prepend(box)})});phaseExplainObserver.observe(document.getElementById('detail'),{childList:true,subtree:true});
let autoRefreshEnabled=true;const nativeSetInterval=window.setInterval.bind(window);window.setInterval=(fn,ms)=>nativeSetInterval(()=>{if(autoRefreshEnabled)fn()},ms);const autoRefreshButton=document.createElement('button');autoRefreshButton.id='autoRefreshButton';autoRefreshButton.textContent='暂停自动刷新';autoRefreshButton.onclick=()=>{autoRefreshEnabled=!autoRefreshEnabled;autoRefreshButton.textContent=autoRefreshEnabled?'暂停自动刷新':'开始自动刷新';if(autoRefreshEnabled)refreshAll()};document.querySelector('.toolbar').appendChild(autoRefreshButton);
let openDetails=[];document.addEventListener('toggle',e=>{if(!e.target.matches('#timeline details'))return;openDetails=[...document.querySelectorAll('#timeline details')].map((d,i)=>d.open?i:-1).filter(i=>i>=0)},true);new MutationObserver(()=>{document.querySelectorAll('#timeline details').forEach((d,i)=>{d.open=openDetails.includes(i)})}).observe(document.getElementById('detail'),{childList:true,subtree:true});
const EID_KEY='wiki_generation_trace_eid',TOKEN_KEY='wiki_generation_trace_token';const tokenInput=document.getElementById('token'),eidInput=document.getElementById('eid');tokenInput.value=localStorage.getItem(TOKEN_KEY)||'';eidInput.value=localStorage.getItem(EID_KEY)||'';tokenInput.addEventListener('input',()=>{const v=tokenInput.value.trim();v?localStorage.setItem(TOKEN_KEY,v):localStorage.removeItem(TOKEN_KEY)});eidInput.addEventListener('input',()=>{const v=eidInput.value.trim();v?localStorage.setItem(EID_KEY,v):localStorage.removeItem(EID_KEY)});let files=[],selected='';function esc(v){return String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}function auth(){return {'X-Access-Token':tokenInput.value.trim()}}async function api(path){const r=await fetch(path,{headers:auth()});return r.json()}function badge(s){return '<span class="badge '+esc(s)+'">'+({running:'进行中',success:'成功',failed:'失败'}[s]||s||'未知')+'</span>'}function renderFiles(){const q=document.getElementById('search').value.trim().toLowerCase(),filter=document.getElementById('status').value;const visible=files.filter(f=>(!filter||f.status===filter)&&(!q||(f.title+' '+f.trace_id).toLowerCase().includes(q)));document.getElementById('fileCount').textContent='('+visible.length+')';document.getElementById('files').innerHTML=visible.length?visible.map(f=>'<div class="file '+(f.file_id===selected?'active':'')+'" onclick="selectFile(\''+esc(f.file_id)+'\')"><div class="file-head"><div class="file-title">'+esc(f.title||'未命名文件')+'</div>'+badge(f.status)+'</div><div class="file-meta">阶段：'+esc(f.phase)+' · 候选 '+(f.candidates||0)+' · 分类命中 '+(f.category_matched||0)+'<br>Trace：'+esc(f.trace_id)+' · '+(f.duration_ms||0)+' ms</div></div>').join(''):'<div class="empty">暂无符合条件的 Wiki 生成文件</div>'}function renderMetrics(){const f=files.find(x=>x.file_id===selected);if(!f)return '';return '<div class="metrics"><div class="metric"><div class="label">候选</div><div class="value">'+(f.candidates||0)+'</div></div><div class="metric"><div class="label">实体 / 概念</div><div class="value">'+(f.entities||0)+' / '+(f.concepts||0)+'</div></div><div class="metric"><div class="label">分类命中</div><div class="value">'+(f.category_matched||0)+'</div></div><div class="metric"><div class="label">页面成功 / 失败</div><div class="value">'+(f.pages_succeeded||0)+' / '+(f.pages_failed||0)+'</div></div></div>'}async function selectFile(id){selected=id;renderFiles();const f=files.find(x=>x.file_id===id);document.getElementById('detail').innerHTML='<div class="detail-head"><div><h2>'+esc(f.title||'未命名文件')+'</h2><div class="muted">Trace '+esc(f.trace_id)+' · '+badge(f.status)+'</div></div><div class="muted">'+(f.terminal_reason?esc(f.terminal_reason):'链路进行中')+'</div></div>'+renderMetrics()+'<div id="timeline" class="timeline">加载事件中...</div>';const j=await api('/api/system_logs/wiki_generation/files/'+encodeURIComponent(id)+'?eid='+encodeURIComponent(eidInput.value.trim()));const events=j.data||[];document.getElementById('timeline').innerHTML=events.length?events.map(e=>'<article class="event '+esc(e.status)+'"><div class="event-top"><div class="event-title">'+esc(e.phase)+' <span class="muted">'+esc(e.status)+'</span></div><div class="event-time">'+new Date(e.time).toLocaleTimeString()+' · '+(e.duration_ms||0)+' ms</div></div><div class="event-body">'+(e.reason?'<div><strong>原因：</strong>'+esc(e.reason)+'</div>':'')+(e.error?'<div class="error"><strong>错误：</strong>'+esc(e.error)+'</div>':'')+(e.counters?'<div><strong>计数：</strong>'+esc(JSON.stringify(e.counters))+'</div>':'')+(e.data?'<details><summary>查看中间结果</summary><pre>'+esc(JSON.stringify(e.data,null,2))+'</pre></details>':'')+'</div></article>').join(''):'<div class="empty">没有事件记录</div>'}async function refreshAll(){const eid=eidInput.value.trim(),token=tokenInput.value.trim();if(!eid||!token)return;const j=await api('/api/system_logs/wiki_generation/files?eid='+encodeURIComponent(eid));files=j.data||[];renderFiles();document.getElementById('updated').textContent='更新于 '+new Date().toLocaleTimeString();if(selected&&files.some(f=>f.file_id===selected))selectFile(selected);else if(files[0])selectFile(files[0].file_id)}document.getElementById('search').addEventListener('input',renderFiles);document.getElementById('status').addEventListener('change',renderFiles);if(eidInput.value&&tokenInput.value)refreshAll();setInterval(refreshAll,5000);
	Object.assign(phaseDescriptions,{category_coarse_filter:'分类初筛：按目标大类过滤候选，展示直接命中、粗筛通过和进入细筛的数量。',category_llm_match:'分类细筛：调用批量 LLM 判断初筛后仍有歧义的候选。'});
	renderMetrics=function(){const f=files.find(x=>x.file_id===selected);if(!f)return '';const metrics=[['总耗时',formatDuration(f.duration_ms)],['LLM 调用',f.llm_calls||0],['Prompt Tokens',f.prompt_tokens||0],['Completion Tokens',f.completion_tokens||0],['Total Tokens',f.total_tokens||0],['候选',f.candidates||0],['分类命中',f.category_matched||0],['页面成功 / 失败',(f.pages_succeeded||0)+' / '+(f.pages_failed||0)]];return '<div class="metrics">'+metrics.map(m=>'<div class="metric"><div class="label">'+m[0]+'</div><div class="value">'+m[1]+'</div></div>').join('')+'</div>'};function formatDuration(ms){if(!ms)return '0 ms';if(ms<1000)return ms+' ms';return (ms/1000).toFixed(1)+' s'}
	setTimeout(()=>{if(eidInput.value&&tokenInput.value)refreshAll()},0);
	</script></body></html>`
