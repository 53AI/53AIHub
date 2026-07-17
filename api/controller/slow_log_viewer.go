package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// SlowLogListRequest 慢日志列表请求参数
type SlowLogListRequest struct {
	Type          string `form:"type"`           // api/sql/all
	Keyword       string `form:"keyword"`        // 搜索关键词
	ResolveStatus int    `form:"resolve_status"` // -1全部 0未解决 1已解决
	Offset        int    `form:"offset" default:"0"`
	Limit         int    `form:"limit" default:"20"`
	SortField     string `form:"sort_field"` // 排序字段
	SortOrder     string `form:"sort_order"` // asc/desc
}

// SlowLogListResponse 慢日志列表响应
type SlowLogListResponse struct {
	Count   int64                  `json:"count"`
	Records []*model.SlowLogRecord `json:"records"`
}

// GetSlowLogs 获取慢日志列表
func GetSlowLogs(c *gin.Context) {
	var req SlowLogListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if req.Limit <= 0 || req.Limit > 100 {
		req.Limit = 20
	}
	records, total, err := model.ListSlowLogRecords(req.Type, req.Keyword, req.ResolveStatus, req.Offset, req.Limit, req.SortField, req.SortOrder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(SlowLogListResponse{
		Count:   total,
		Records: records,
	}))
}

// ResolveSlowLog 解决慢日志
func ResolveSlowLog(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if err := model.ResolveSlowLogRecord(id); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// IgnoreSlowLog 标记慢日志为无需解决
func IgnoreSlowLog(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if err := model.IgnoreSlowLogRecord(id); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetSlowLogsUI 慢日志 UI 页面
func GetSlowLogsUI(c *gin.Context) {
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(slowLogsUIHTML))
}

const slowLogsUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>53AIHub 慢日志记录</title>
  <style>
    :root { --bg:#f5f7fb; --card:#fff; --line:#dde3ea; --text:#1c2633; --muted:#64748b; --brand:#0f766e; --hl:#e6f8f3; --red:#dc2626; --green:#16a34a; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    .wrap { max-width: 1400px; margin: 24px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
    .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
    .row { display:flex; gap:8px; align-items: center; }
    label { font-size: 12px; color: var(--muted); display:block; margin-bottom: 4px; }
    input, select, button { width:100%; border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
    button { cursor:pointer; background:#fff; }
    .btn-primary { background: var(--brand); color:#fff; border-color: var(--brand); }
    .toolbar { display:flex; justify-content: space-between; gap:8px; margin-top: 8px; }
    .status { font-size:12px; color: var(--muted); }
    table { width:100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
    th, td { border-bottom: 1px solid var(--line); text-align:left; padding:6px; font-size: 12px; vertical-align: top; word-break: break-word; }
    th { background:#f8fafc; position: sticky; top: 0; font-size:11px; color: var(--muted); font-weight: 600; }
    th:nth-child(1) { width: 50px; }
    th:nth-child(2) { width: 50px; }
    th:nth-child(3) { width: 60px; }
    th:nth-child(4) { width: 280px; }
    th:nth-child(5) { width: 50px; }
    th:nth-child(6) { width: 50px; }
    th:nth-child(7) { width: 100px; }
    th:nth-child(8) { width: 140px; }
    th:nth-child(9) { width: auto; }
    th:nth-child(10) { width: 140px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .sample-data { max-height: 50px; overflow: hidden; cursor: pointer; }
    .sample-data.expanded { max-height: none; }
    .tag { display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; }
    .tag-api { background:#e0f2fe; color:#0369a1; }
    .tag-sql { background:#fef3c7; color:#92400e; }
    .tag-resolved { background:#dcfce7; color:#166534; }
    .tag-unresolved { background:#fce4ec; color:#c62828; }
    .tag-ignored { background:#f1f5f9; color:#475569; }
    .action-btn { width: auto; padding: 2px 8px; font-size: 11px; border-radius: 6px; color: #334155; }
    .pagination { display:flex; gap:8px; align-items:center; margin-top:10px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2 style="margin:0 0 10px 0;">53AIHub 慢日志记录</h2>
      <div style="margin-bottom:10px;">
        <label>鉴权 Token（仅支持 ENV: FILE_LOG_VIEWER_ACCESS_TOKEN）</label>
        <input id="token" placeholder="粘贴 FILE_LOG_VIEWER_ACCESS_TOKEN，刷新后会自动保留" />
      </div>
      <div class="grid">
        <div><label>类型</label><select id="type"><option value="all">全部</option><option value="api">接口</option><option value="sql">SQL</option></select></div>
        <div><label>状态</label><select id="resolveStatus"><option value="0">未解决</option><option value="1">已解决</option><option value="2">无需解决</option><option value="-1">全部</option></select></div>
        <div><label>关键词</label><input id="keyword" placeholder="feature/sample_data 模糊匹配" /></div>
        <div><label>每页数量</label><input id="limit" type="number" value="20" min="1" max="100" /></div>
        <div class="row" style="align-items:end;"><button class="btn-primary" id="searchBtn">查询</button></div>
      </div>
      <div class="toolbar">
        <div class="status" id="status">等待查询</div>
        <div class="pagination">
          <button id="prevBtn">上一页</button>
          <span id="pageInfo" style="font-size:12px;color:var(--muted);">第 1 页</span>
          <button id="nextBtn">下一页</button>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>ID</th><th>类型</th><th>状态</th><th>特征</th><th id="sortSlowest" style="cursor:pointer;user-select:none;">最慢(ms) <span id="arrowSlowest">▼</span></th><th>触发</th><th>文件行</th><th id="sortTime" style="cursor:pointer;user-select:none;">更新时间 <span id="arrowTime" style="display:none;"></span></th><th>采样数据</th><th>操作</th></tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>

  <script>
      const state = { offset: 0, total: 0, records: [], sortField: 'slowest_ms', sortOrder: 'desc' };

    const tokenInput = document.getElementById('token');
    const LOG_TOKEN_KEY = 'slow_log_viewer_token';
    tokenInput.value = localStorage.getItem(LOG_TOKEN_KEY) || '';
    tokenInput.addEventListener('input', () => {
      const v = tokenInput.value.trim();
      if (v) localStorage.setItem(LOG_TOKEN_KEY, v);
      else localStorage.removeItem(LOG_TOKEN_KEY);
    });

    function withAuth() {
      const headers = {};
      const t = tokenInput.value.trim();
      if (t) {
        const clean = t.replace(/^Bearer\s+/i, '');
        headers['Authorization'] = 'Bearer ' + clean;
      }
      return headers;
    }

    function formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function toggleSample(el) {
      el.classList.toggle('expanded');
    }

    function copyFixPrompt(btn, id) {
      const r = state.records.find(function(x) { return String(x.id) === id || x.id === id; });
      if (!r) return;
      const lines = [
        '## 慢日志修复任务',
        '',
        '**类型**: ' + (r.type === 'api' ? '接口' : 'SQL'),
        '**特征**: ' + r.feature,
        '**最慢耗时**: ' + r.slowest_ms + 'ms',
        '**触发次数**: ' + r.trigger_count,
      ];
      if (r.file_line && r.file_line !== '-') {
        lines.push('**触发位置**: ' + r.file_line);
      }
      if (r.sample_data) {
        lines.push('**采样数据**:');
        lines.push(r.sample_data);
      }
      lines.push('');
      lines.push('请根据以上慢日志信息，规划修复方案。\n 注意 \n -懒人模式:\n - 如果是慢 sql： models 能自动添加索引？，要考虑索引长度在 mysql5.6 的限制 \n - 可以使用技能 sql-query 进行 explan');

      var text = lines.join('\n');
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        var orig = btn.textContent;
        btn.textContent = '\u5df2\u590d\u5236';
        setTimeout(function() { btn.textContent = orig; }, 1500);
      } catch(e) {
        alert('\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236');
      }
      document.body.removeChild(ta);
    }

    async function resolveLog(id) {
      if (!confirm('确定标记该记录为已解决？（若再次出现将自动还原）')) return;
      try {
        const p = new URLSearchParams();
        const t = tokenInput.value.trim();
        if (t) p.set('access_token', t);
        const headers = withAuth();
        headers['Content-Type'] = 'application/json';
        const resp = await fetch('/api/system_logs/slow_logs/' + id + '/resolve?' + p.toString(), { method: 'POST', headers });
        const json = await resp.json();
        if (!resp.ok || (json && json.success === false)) {
          throw new Error((json && json.message) || ('HTTP ' + resp.status));
        }
        search(false);
      } catch (e) {
        alert('操作失败: ' + (e && e.message ? e.message : e));
      }
    }

    async function ignoreLog(id) {
      if (!confirm('确定标记为无需解决？（再次触发不会自动还原为未解决）')) return;
      try {
        const p = new URLSearchParams();
        const t = tokenInput.value.trim();
        if (t) p.set('access_token', t);
        const headers = withAuth();
        headers['Content-Type'] = 'application/json';
        const resp = await fetch('/api/system_logs/slow_logs/' + id + '/ignore?' + p.toString(), { method: 'POST', headers });
        const json = await resp.json();
        if (!resp.ok || (json && json.success === false)) {
          throw new Error((json && json.message) || ('HTTP ' + resp.status));
        }
        search(false);
      } catch (e) {
        alert('操作失败: ' + (e && e.message ? e.message : e));
      }
    }

    async function search(reset) {
      if (reset) { state.offset = 0; }
      const p = new URLSearchParams();
      p.set('type', document.getElementById('type').value);
      p.set('resolve_status', document.getElementById('resolveStatus').value);
      p.set('keyword', document.getElementById('keyword').value.trim());
      p.set('sort_field', state.sortField);
      p.set('sort_order', state.sortOrder);
      p.set('offset', String(state.offset));
      p.set('limit', Math.max(1, Math.min(100, Number(document.getElementById('limit').value || 20))));
      const t = tokenInput.value.trim();
      if (t) p.set('access_token', t);

      document.getElementById('status').textContent = '查询中...';
      try {
        const headers = withAuth();
        const resp = await fetch('/api/system_logs/slow_logs?' + p.toString(), { headers });
        const json = await resp.json();
        if (!resp.ok || (json && json.success === false)) {
          throw new Error((json && json.message) || ('HTTP ' + resp.status));
        }
        const data = json.data || {};
        state.total = data.count || 0;
        renderRows(data.records || []);
        const page = Math.floor(state.offset / Math.max(1, Number(document.getElementById('limit').value || 20))) + 1;
        document.getElementById('pageInfo').textContent = '第 ' + page + ' 页 / 共 ' + data.count + ' 条';
        document.getElementById('status').textContent = '查询完成';
      } catch (e) {
        document.getElementById('status').textContent = '查询失败: ' + (e && e.message ? e.message : e);
      }
    }

    function renderRows(records) {
      state.records = records;
      const tb = document.getElementById('tbody');
      tb.innerHTML = '';
      for (const r of records) {
        const tr = document.createElement('tr');
        const typeClass = r.type === 'api' ? 'tag-api' : 'tag-sql';
        const statusClass = r.resolve_status === 1 ? 'tag-resolved' : (r.resolve_status === 2 ? 'tag-ignored' : 'tag-unresolved');
        const statusText = r.resolve_status === 1 ? '已解决' : (r.resolve_status === 2 ? '无需解决' : '未解决');
        tr.innerHTML = [
          '<td class="mono">' + r.id + '</td>',
          '<td><span class="tag ' + typeClass + '">' + r.type + '</span></td>',
          '<td><span class="tag ' + statusClass + '">' + statusText + '</span></td>',
          '<td class="mono" style="font-size:11px;">' + escapeHtml(r.feature) + '</td>',
          '<td class="mono">' + r.slowest_ms + '</td>',
          '<td class="mono">' + r.trigger_count + '</td>',
          '<td class="mono" style="font-size:11px;">' + escapeHtml(r.file_line || '-') + '</td>',
          '<td style="font-size:11px;">' + formatTime(r.updated_at) + '</td>',
          '<td><div class="sample-data mono" onclick="toggleSample(this)" style="font-size:11px;">' + escapeHtml(r.sample_data || '') + '</div></td>',
          '<td>' + (r.resolve_status === 0
            ? '<button class="action-btn" onclick="resolveLog(\'' + escapeHtml(String(r.id)) + '\')">标记解决</button> <button class="action-btn" onclick="ignoreLog(\'' + escapeHtml(String(r.id)) + '\')">无需解决</button>'
            : (r.resolve_status === 2
              ? '<span style="font-size:11px;color:var(--muted);">无需解决</span>'
              : '<span style="font-size:11px;color:var(--muted);">已解决</span>')) + ' <button class="action-btn" onclick="copyFixPrompt(this,\'' + escapeHtml(String(r.id)) + '\')">复制提示词</button></td>'
        ].join('');
        tb.appendChild(tr);
      }
      if (records.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="10" style="text-align:center;padding:20px;color:var(--muted);">暂无慢日志记录</td>';
        tb.appendChild(tr);
      }
    }

    function toggleSort(field) {
      if (state.sortField === field) {
        state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortField = field;
        state.sortOrder = 'desc';
      }
      document.getElementById('arrowSlowest').textContent = '';
      document.getElementById('arrowTime').textContent = '';
      document.getElementById('arrowSlowest').style.display = 'none';
      document.getElementById('arrowTime').style.display = 'none';
      const arrow = state.sortField === 'slowest_ms' ? 'arrowSlowest' : 'arrowTime';
      document.getElementById(arrow).textContent = state.sortOrder === 'desc' ? '▼' : '▲';
      document.getElementById(arrow).style.display = '';
      search(true);
    }
    document.getElementById('sortSlowest').addEventListener('click', () => toggleSort('slowest_ms'));
    document.getElementById('sortTime').addEventListener('click', () => toggleSort('updated_at'));
    document.getElementById('searchBtn').addEventListener('click', () => search(true));
    document.getElementById('prevBtn').addEventListener('click', () => {
      const limit = Math.max(1, Math.min(100, Number(document.getElementById('limit').value || 20)));
      state.offset = Math.max(0, state.offset - limit);
      search(false);
    });
    document.getElementById('nextBtn').addEventListener('click', () => {
      const limit = Math.max(1, Math.min(100, Number(document.getElementById('limit').value || 20)));
      if (state.offset + limit < state.total) {
        state.offset += limit;
        search(false);
      }
    });
  </script>
</body>
</html>`
