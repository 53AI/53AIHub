package controller

import "strings"

// lazy: 7个system_logs调试工具统一导航头；新增工具只改sysLogTools一处。
// 各UI页在HTML const里放 <!--SYSLOG_NAV--> 占位符，handler用
// strings.Replace(html, "<!--SYSLOG_NAV-->", SystemLogNavHTML("本页path"), 1) 注入。
// 内联样式，不依赖各页自有CSS（深色页同样可读）。

type sysLogTool struct {
	path  string
	label string
}

var sysLogTools = []sysLogTool{
	{"/api/system_logs/file_logs/ui", "文件日志"},
	{"/api/system_logs/slow_logs/ui", "慢日志监控"},
	{"/api/system_logs/vectorize/ui", "向量化日志"},
	{"/api/system_logs/wiki_generation/ui", "Wiki生成监控"},
	{"/api/system_logs/chat_debug/ui", "Chat过程调试"},
	{"/api/system_logs/recording_insight_debug/ui", "会议纪要→洞察"},
	{"/api/system_logs/api_trace/ui", "API调用过程"},
}

// SystemLogNavHTML 渲染统一导航头，active为当前页path（高亮且本页不新开窗口）。
func SystemLogNavHTML(active string) string {
	var b strings.Builder
	b.WriteString(`<nav style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">`)
	for _, t := range sysLogTools {
		style := `background:#fff;color:#1c2633;border:1px solid #d7dee8;`
		target := ` target="_blank" rel="noopener"`
		if t.path == active {
			style = `background:#1a5fb4;color:#fff;border:1px solid #1a5fb4;font-weight:600;`
			target = ``
		}
		b.WriteString(`<a href="` + t.path + `"` + target + ` style="text-decoration:none;">` +
			`<button type="button" style="width:auto;padding:6px 14px;font-size:13px;border-radius:8px;cursor:pointer;` + style + `">` + t.label + `</button></a>`)
	}
	b.WriteString(`</nav>`)
	return b.String()
}
