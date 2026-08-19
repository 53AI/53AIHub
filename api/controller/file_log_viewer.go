package controller

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/logviewer"
	"github.com/gin-gonic/gin"
)

// SearchFileLogsRequest 单机日志查询参数
type SearchFileLogsRequest struct {
	FileType        string `form:"file_type"`
	Keyword         string `form:"keyword"`
	Level           string `form:"level"`
	RequestID       string `form:"request_id"`
	Line            int    `form:"line"`
	StartTime       int64  `form:"start_time"`
	EndTime         int64  `form:"end_time"`
	Offset          int    `form:"offset" default:"0"`
	Limit           int    `form:"limit" default:"50"`
	AnchorFile      string `form:"anchor_file"`
	AnchorLine      int    `form:"anchor_line"`
	Around          int    `form:"around" default:"20"`
	AnchorDirection string `form:"anchor_direction"`
	NoArchive       bool   `form:"no_archive"` // 是否跳过 archive/ 目录中的归档日志
}

type FileLogsSearchResponse struct {
	HasMore bool                `json:"has_more"`
	Logs    []logviewer.LogItem `json:"logs"`
}

// SearchFileLogs godoc
// @Summary 搜索单机文件日志
// @Description 按日志文件类型、级别、关键词、request_id、时间范围进行搜索（仅 FILE_LOG_VIEWER_ACCESS_TOKEN）
// @Tags SystemLog
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_type query string false "日志文件类型: all/main/error/crash/ragjob" default(all)
// @Param keyword query string false "关键词（匹配 raw/msg）"
// @Param level query string false "日志级别（debug/info/warn/error/crash/fatal）"
// @Param request_id query string false "请求ID"
// @Param line query int false "日志行号（精确匹配）"
// @Param start_time query int64 false "开始时间（毫秒时间戳）"
// @Param end_time query int64 false "结束时间（毫秒时间戳）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量（最大200）" default(50)
// @Param anchor_file query string false "锚点文件名（用于查看附近日志）"
// @Param anchor_line query int false "锚点行号（用于查看附近日志）"
// @Param around query int false "上下文行数（默认20，最大200）"
// @Param anchor_direction query string false "锚点方向：up/down/around（默认around）"
// @Param no_archive query bool false "是否跳过归档日志" default(false)
// @Success 200 {object} model.CommonResponse{data=FileLogsSearchResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/system_logs/file_logs/search [get]
func SearchFileLogs(c *gin.Context) {
	var req SearchFileLogsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	logDir := strings.TrimSpace(config.LogDir)
	if logDir == "" {
		logDir = "./logs"
	}
	absDir, absErr := filepath.Abs(logDir)
	if absErr == nil {
		logDir = absDir
	}

	result, err := logviewer.SearchLogs(logviewer.SearchQuery{
		Dir:        logDir,
		FileType:   req.FileType,
		Keyword:    req.Keyword,
		Level:      req.Level,
		RequestID:  req.RequestID,
		Line:       req.Line,
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Offset:     req.Offset,
		Limit:      req.Limit,
		AnchorFile: req.AnchorFile,
		AnchorLine: req.AnchorLine,
		Around:     req.Around,
		Direction:  req.AnchorDirection,
		NoArchive:  req.NoArchive, // 默认 false=搜索时包含 archive/ 目录中的归档日志
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(FileLogsSearchResponse{
		HasMore: result.HasMore,
		Logs:    result.Logs,
	}))
}

// GetFileLogsUI godoc
// @Summary 单机日志检索页面
// @Description 返回内置日志检索页面，可输入 token 后按条件查询日志
// @Tags SystemLog
// @Accept json
// @Produce html
// @Success 200 {string} string "HTML page"
// @Router /api/system_logs/file_logs/ui [get]
func GetFileLogsUI(c *gin.Context) {
	// 将 BuildTime "20060102150405" 格式化为可读 "2006-01-02 15:04:05"
	bt := config.BuildTime
	if len(bt) == 14 {
		bt = bt[:4] + "-" + bt[4:6] + "-" + bt[6:8] + " " + bt[8:10] + ":" + bt[10:12] + ":" + bt[12:14]
	}
	html := strings.Replace(fileLogsUIHTML, "{{VERSION}}", config.Version, 1)
	html = strings.Replace(html, "{{BUILD_TIME}}", bt, 1)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// ArchiveResponse 归档结果
type ArchiveResponse struct {
	ArchivedFiles []logviewer.ArchivedFile `json:"archived_files"`
	TotalSize     string                   `json:"total_size"`
	ArchivedSize  string                   `json:"archived_size"`
}

// ArchiveFileLogs godoc
// @Summary 归档非当前活跃的日志文件
// @Description 将非当前活跃的日志文件 gzip 压缩后移至 archive/ 子目录，减少日志读取量，提升搜索性能
// @Tags 系统日志
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=ArchiveResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/system_logs/file_logs/archive [post]
func ArchiveFileLogs(c *gin.Context) {
	logDir := strings.TrimSpace(config.LogDir)
	if logDir == "" {
		logDir = "./logs"
	}
	absDir, absErr := filepath.Abs(logDir)
	if absErr == nil {
		logDir = absDir
	}

	result, err := logviewer.ArchiveOldLogs(logDir)
	if err != nil {
		logger.Errorf(c, "【文件日志】归档失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(ArchiveResponse{
		ArchivedFiles: result.ArchivedFiles,
		TotalSize:     formatFileSize(result.TotalSize),
		ArchivedSize:  formatFileSize(result.ArchivedSize),
	}))
}

func formatFileSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	} else if bytes < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
}

const fileLogsUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>53AIHub 单机日志检索</title>
  <style>
    :root { --bg:#f5f7fb; --card:#fff; --line:#dde3ea; --text:#1c2633; --muted:#64748b; --brand:#0f766e; --hl:#e6f8f3; }
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
    th:nth-child(1) { width: 170px; }
    th:nth-child(2) { width: 70px; }
    th:nth-child(3) { width: 240px; }
    th:nth-child(4) { width: 170px; }
    th:nth-child(5) { width: 90px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .msg { white-space: pre-wrap; line-height: 1.35; margin: 0; font-size: 12px; }
    .meta-row td { background: #fff; padding-top:4px; padding-bottom:4px; font-size:11px; color:#516176; }
    .detail-row td { background: #fff; padding-top: 2px; padding-bottom: 8px; border-bottom: 1px solid #e9eef5; }
    .content-box { border-left: 2px solid #d7e2ef; padding-left: 8px; }
    .action-btn { width: auto; padding: 2px 8px; font-size: 11px; border-radius: 6px; color: #334155; }
    .viewer-modal { position: fixed; inset: 0; background: rgba(12,18,28,0.46); z-index: 1200; display: none; align-items: center; justify-content: center; padding: 14px; }
    .viewer-modal.show { display: flex; }
    .viewer-dialog { width: min(1320px, 96vw); height: 88vh; background: #fff; border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 18px 48px rgba(21,36,52,0.24); }
    .viewer-head { display:flex; justify-content: space-between; align-items:center; gap:8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .viewer-actions { display:flex; gap:8px; align-items:center; }
    .viewer-box { border: 0; border-radius: 0; height: auto; flex: 1; overflow-y: auto; background: #fff; }
    .viewer-empty { color: var(--muted); font-size: 12px; text-align: center; padding: 18px; }
    .log-item { border-bottom: 1px dashed #e6edf5; padding: 6px 10px; }
    .log-item.anchor { background: var(--hl); border-left: 3px solid var(--brand); padding-left: 7px; }
    .log-meta { color: #5d6f85; font-size: 11px; margin-bottom: 4px; }
    .log-msg { margin:0; white-space: pre-wrap; line-height: 1.35; font-size: 12px; color: #203247; }
    .inline-btn { width:auto; padding:4px 10px; font-size:12px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .viewer-dialog { width: 98vw; height: 92vh; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2 style="margin:0 0 0 0;">53AIHub 单机日志检索</h2>
      <div style="font-size:14px;font-weight:600;color:var(--brand);padding:10px 12px;background:#e6f8f3;border-radius:8px;margin-bottom:10px;">版本: {{VERSION}} | 编译: {{BUILD_TIME}}</div>
      <div style="margin-bottom:10px;">
        <label>鉴权 Token（仅支持 ENV: FILE_LOG_VIEWER_ACCESS_TOKEN）</label>
        <input id="token" placeholder="粘贴 FILE_LOG_VIEWER_ACCESS_TOKEN，刷新后会自动保留" />
      </div>
      <div class="grid">
        <div><label>文件类型</label><select id="fileType"><option value="all">all</option><option value="main">main</option><option value="error">error</option><option value="crash">crash</option><option value="ragjob">ragjob</option><option value="slow">slow（慢日志）</option></select></div>
        <div><label>级别</label><select id="level"><option value="">全部</option><option>debug</option><option>info</option><option>warn</option><option>error</option><option>crash</option><option>fatal</option></select></div>
        <div><label>关键词</label><input id="keyword" placeholder="msg/raw 模糊匹配" /></div>
        <div><label>request_id</label><input id="requestId" placeholder="精确匹配" /></div>
        <div><label>行号</label><input id="lineNo" type="number" min="1" placeholder="例如 1904" /></div>
        <div><label>开始时间</label><input id="start" type="datetime-local" /></div>
        <div><label>结束时间</label><input id="end" type="datetime-local" /></div>
        <div><label>每页数量</label><input id="limit" type="number" value="50" min="1" max="200" /></div>
        <div><label>定位加载行数</label><input id="around" type="number" value="40" min="1" max="200" /></div>
        <div class="row" style="align-items:end;"><label><input id="includeArchive" type="checkbox" /> 包含归档日志</label></div>
        <div class="row" style="align-items:end;"><button class="btn-primary" id="searchBtn">搜索</button></div>
      </div>
      <div class="toolbar">
        <div class="status" id="status">等待查询</div>
        <div class="row" style="width:auto;gap:4px;">
          <button id="archiveBtn" style="width:auto;padding:4px 12px;font-size:12px;background:#e8f0fe;border:1px solid #a8c7fa;border-radius:6px;cursor:pointer;">归档旧日志</button>
          <button id="prevBtn">上一页</button>
          <button id="nextBtn">下一页</button>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>时间</th><th>级别</th><th>位置</th><th>request_id</th><th>操作</th></tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <div id="viewerModal" class="viewer-modal">
      <div class="viewer-dialog">
        <div class="viewer-head">
          <div class="status" id="viewerStatus">定位后可上下滚动加载日志</div>
          <div class="viewer-actions">
            <button id="clearViewerBtn" class="inline-btn">清空定位</button>
            <button id="closeViewerBtn" class="inline-btn">关闭</button>
          </div>
        </div>
        <div id="viewerBox" class="viewer-box">
          <div id="viewerList" class="viewer-empty">请先搜索并点击“定位”</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const state = {
      offset: 0,
      hasMore: false,
      context: {
        enabled: false,
        file: '',
        fileType: 'main',
        anchorLine: 0,
        minLine: 0,
        maxLine: 0,
        rows: [],
        loadingUp: false,
        loadingDown: false,
        reachedTop: false,
        reachedBottom: false
      }
    };

    const tokenInput = document.getElementById('token');
    const viewerBox = document.getElementById('viewerBox');
    const viewerModal = document.getElementById('viewerModal');
    const LOG_TOKEN_KEY = 'file_log_viewer_token';
    tokenInput.value = localStorage.getItem(LOG_TOKEN_KEY) || localStorage.getItem('token') || localStorage.getItem('access_token') || '';
    tokenInput.addEventListener('input', () => {
      const v = tokenInput.value.trim();
      if (v) localStorage.setItem(LOG_TOKEN_KEY, v);
      else localStorage.removeItem(LOG_TOKEN_KEY);
    });

    function toMillis(id) {
      const v = document.getElementById(id).value;
      if (!v) return '';
      const n = new Date(v).getTime();
      return Number.isFinite(n) ? String(n) : '';
    }

    function currentAround() {
      return Math.max(1, Math.min(200, Number(document.getElementById('around').value || 40)));
    }

    function searchParams() {
      const p = new URLSearchParams();
      p.set('file_type', document.getElementById('fileType').value);
      const level = document.getElementById('level').value;
      const keyword = document.getElementById('keyword').value.trim();
      const requestId = document.getElementById('requestId').value.trim();
      const lineNo = Math.max(0, Number(document.getElementById('lineNo').value || 0));
      const start = toMillis('start');
      const end = toMillis('end');
      const limit = Math.max(1, Math.min(200, Number(document.getElementById('limit').value || 50)));
      p.set('offset', String(state.offset));
      p.set('limit', String(limit));
      if (level) p.set('level', level);
      if (keyword) p.set('keyword', keyword);
      if (requestId) p.set('request_id', requestId);
      if (lineNo > 0) p.set('line', String(lineNo));
      if (start) p.set('start_time', start);
      if (end) p.set('end_time', end);
      p.set('no_archive', document.getElementById('includeArchive').checked ? 'false' : 'true');
      return p;
    }

    function withAuth(p) {
      const headers = {};
      const t = tokenInput.value.trim();
      if (t) {
        const clean = t.replace(/^Bearer\s+/i, '');
        headers['Authorization'] = 'Bearer ' + clean;
        p.set('access_token', clean);
      }
      return headers;
    }

    async function fetchSearch(p) {
      const headers = withAuth(p);
      const resp = await fetch('/api/system_logs/file_logs/search?' + p.toString(), { headers });
      const json = await resp.json();
      if (!resp.ok || (json && json.success === false)) {
        throw new Error((json && json.message) || ('HTTP ' + resp.status));
      }
      return json.data || {};
    }

    function guessFileType(file) {
      const f = String(file || '');
      if (f.startsWith('53AIHub-error')) return 'error';
      if (f.startsWith('53AIHub-crash')) return 'crash';
      if (f.startsWith('Ragjob-')) return 'ragjob';
      return 'main';
    }

    function formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function formatMessage(msg) {
      if (msg == null) return '';
      const text = String(msg).trim();
      if (!text) return '';
      if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try {
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch (e) {
          return text;
        }
      }
      return text;
    }

    function normalizeRows(rows) {
      return (rows || []).slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    }

    function mergeRows(existing, incoming) {
      const map = new Map();
      for (const r of existing || []) {
        const ln = Number(r.line || 0);
        if (ln > 0) map.set(ln, r);
      }
      for (const r of incoming || []) {
        const ln = Number(r.line || 0);
        if (ln > 0) map.set(ln, r);
      }
      return Array.from(map.values()).sort((a, b) => (a.line || 0) - (b.line || 0));
    }

    function renderSearchRows(rows) {
      const tb = document.getElementById('tbody');
      tb.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.className = 'meta-row';
        const fileLine = (r.file || '') + ':' + (r.line || '');
        const cols = [formatTime(r.timestamp), r.level || '', fileLine, r.request_id || ''];
        for (let i = 0; i < cols.length; i++) {
          const td = document.createElement('td');
          td.textContent = String(cols[i]);
          if (i >= 1) td.className = 'mono';
          tr.appendChild(td);
        }

        const actionTd = document.createElement('td');
        const locateBtn = document.createElement('button');
        locateBtn.className = 'action-btn';
        locateBtn.textContent = '定位';
        locateBtn.addEventListener('click', () => locateAndLoad(r));
        actionTd.appendChild(locateBtn);
        tr.appendChild(actionTd);
        tb.appendChild(tr);

        const detailTr = document.createElement('tr');
        detailTr.className = 'detail-row';
        const detailTd = document.createElement('td');
        detailTd.colSpan = 5;
        const box = document.createElement('div');
        box.className = 'content-box';
        const pre = document.createElement('pre');
        pre.className = 'msg mono';
        pre.textContent = formatMessage(r.message || '');
        box.appendChild(pre);
        detailTd.appendChild(box);
        detailTr.appendChild(detailTd);
        tb.appendChild(detailTr);
      }
    }

    function setViewerStatus(text) {
      document.getElementById('viewerStatus').textContent = text;
    }

    function openViewerModal() {
      viewerModal.classList.add('show');
      document.body.style.overflow = 'hidden';
    }

    function closeViewerModal() {
      viewerModal.classList.remove('show');
      document.body.style.overflow = '';
    }

    function renderViewer() {
      const list = document.getElementById('viewerList');
      const c = state.context;
      if (!c.enabled) {
        list.className = 'viewer-empty';
        list.textContent = '请先搜索并点击“定位”';
        return;
      }
      if (!c.rows.length) {
        list.className = 'viewer-empty';
        list.textContent = '该位置附近没有可显示日志';
        return;
      }

      list.className = '';
      list.innerHTML = '';
      for (const r of c.rows) {
        const item = document.createElement('div');
        item.className = 'log-item' + (Number(r.line || 0) === c.anchorLine ? ' anchor' : '');
        item.dataset.line = String(r.line || 0);

        const meta = document.createElement('div');
        meta.className = 'log-meta mono';
        meta.textContent = 'line ' + String(r.line || 0) + ' | ' + formatTime(r.timestamp) + ' | ' + String(r.level || '-') + ' | request_id=' + String(r.request_id || '');
        item.appendChild(meta);

        const msg = document.createElement('pre');
        msg.className = 'log-msg mono';
        msg.textContent = formatMessage(r.message || '');
        item.appendChild(msg);
        list.appendChild(item);
      }
    }

    function resetViewer() {
      state.context = {
        enabled: false,
        file: '',
        fileType: 'main',
        anchorLine: 0,
        minLine: 0,
        maxLine: 0,
        rows: [],
        loadingUp: false,
        loadingDown: false,
        reachedTop: false,
        reachedBottom: false
      };
      renderViewer();
      setViewerStatus('定位后可上下滚动加载日志');
    }

    async function loadContext(direction, anchorLine) {
      const c = state.context;
      if (!c.enabled || !c.file || anchorLine <= 0) return;
      const around = currentAround();
      if (direction === 'up' && (c.loadingUp || c.reachedTop)) return;
      if (direction === 'down' && (c.loadingDown || c.reachedBottom)) return;

      const prevHeight = viewerBox.scrollHeight;
      if (direction === 'up') c.loadingUp = true;
      if (direction === 'down') c.loadingDown = true;
      if (direction === 'around') {
        c.loadingUp = true;
        c.loadingDown = true;
      }

      const p = new URLSearchParams();
      p.set('file_type', c.fileType);
      p.set('anchor_file', c.file);
      p.set('anchor_line', String(anchorLine));
      p.set('around', String(around));
      p.set('anchor_direction', direction);

      try {
        const data = await fetchSearch(p);
        const incoming = normalizeRows(data.logs || []);
        if (direction === 'around') {
          c.rows = incoming;
          c.reachedTop = false;
          c.reachedBottom = false;
        } else {
          c.rows = mergeRows(c.rows, incoming);
        }

        if (c.rows.length) {
          c.minLine = Number(c.rows[0].line || 0);
          c.maxLine = Number(c.rows[c.rows.length - 1].line || 0);
        }
        if (direction === 'up' && (incoming.length === 0 || incoming.length < around || c.minLine <= 1)) c.reachedTop = true;
        if (direction === 'down' && (incoming.length === 0 || incoming.length < around)) c.reachedBottom = true;
        if (direction === 'around' && c.minLine <= 1) c.reachedTop = true;

        renderViewer();
        if (direction === 'around') {
          const target = viewerBox.querySelector('[data-line="' + String(c.anchorLine) + '"]');
          if (target) target.scrollIntoView({ block: 'center' });
        } else if (direction === 'up') {
          const delta = viewerBox.scrollHeight - prevHeight;
          viewerBox.scrollTop += delta;
        }
        setViewerStatus('已定位 ' + c.file + ':' + c.anchorLine + '，当前加载 ' + c.rows.length + ' 行');
      } catch (e) {
        setViewerStatus('定位加载失败: ' + (e && e.message ? e.message : e));
      } finally {
        c.loadingUp = false;
        c.loadingDown = false;
      }
    }

    async function locateAndLoad(row) {
      const c = state.context;
      openViewerModal();
      c.enabled = true;
      c.file = String(row.file || '');
      c.fileType = guessFileType(c.file);
      c.anchorLine = Number(row.line || 0);
      c.minLine = 0;
      c.maxLine = 0;
      c.rows = [];
      c.reachedTop = false;
      c.reachedBottom = false;
      renderViewer();
      setViewerStatus('定位加载中...');
      await loadContext('around', c.anchorLine);
    }

    async function search(reset) {
      if (reset) state.offset = 0;
      const p = searchParams();
      document.getElementById('status').textContent = '查询中...';
      try {
        const data = await fetchSearch(p);
        state.hasMore = !!data.has_more;
        renderSearchRows(data.logs || []);
        document.getElementById('status').textContent = 'offset=' + state.offset + ', 当前返回 ' + (data.logs || []).length + ' 条, has_more=' + state.hasMore;
      } catch (e) {
        document.getElementById('status').textContent = '查询失败: ' + (e && e.message ? e.message : e);
      }
    }

    viewerBox.addEventListener('scroll', () => {
      const c = state.context;
      if (!c.enabled || c.loadingUp || c.loadingDown || !c.rows.length) return;
      const topGap = viewerBox.scrollTop;
      const bottomGap = viewerBox.scrollHeight - (viewerBox.scrollTop + viewerBox.clientHeight);
      if (topGap < 120 && c.minLine > 1 && !c.reachedTop) {
        loadContext('up', c.minLine);
        return;
      }
      if (bottomGap < 120 && c.maxLine > 0 && !c.reachedBottom) {
        loadContext('down', c.maxLine);
      }
    });

    document.getElementById('searchBtn').addEventListener('click', () => search(true));
    document.getElementById('nextBtn').addEventListener('click', () => {
      const limit = Math.max(1, Math.min(200, Number(document.getElementById('limit').value || 50)));
      state.offset += limit;
      search(false);
    });
    document.getElementById('prevBtn').addEventListener('click', () => {
      const limit = Math.max(1, Math.min(200, Number(document.getElementById('limit').value || 50)));
      state.offset = Math.max(0, state.offset - limit);
      search(false);
    });
    document.getElementById('clearViewerBtn').addEventListener('click', () => resetViewer());
    document.getElementById('closeViewerBtn').addEventListener('click', () => closeViewerModal());
    viewerModal.addEventListener('click', (e) => {
      if (e.target === viewerModal) closeViewerModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && viewerModal.classList.contains('show')) closeViewerModal();
    });

    document.getElementById('archiveBtn').addEventListener('click', async () => {
      if (!confirm('确定归档所有日志文件？\n日志将被复制到 archive/ 目录，原日志将被清空。')) return;
      const btn = document.getElementById('archiveBtn');
      btn.disabled = true;
      btn.textContent = '归档中...';
      try {
        const p = new URLSearchParams();
        const headers = withAuth(p);
        const resp = await fetch('/api/system_logs/file_logs/archive', {
          method: 'POST',
          headers: Object.assign({'Content-Type': 'application/json'}, headers)
        });
        const json = await resp.json();
        if (!resp.ok || (json && json.success === false)) {
          throw new Error((json && json.message) || ('HTTP ' + resp.status));
        }
        const data = json.data || {};
        const files = data.archived_files || [];
        if (files.length === 0) {
          alert('没有需要归档的日志文件');
        } else {
          alert('归档完成\n归档 ' + files.length + ' 个文件\n原始大小: ' + (data.total_size || '') + '\n压缩后: ' + (data.archived_size || ''));
        }
      } catch (e) {
        alert('归档失败: ' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
        btn.textContent = '归档旧日志';
      }
    });
  </script>
</body>
</html>`
