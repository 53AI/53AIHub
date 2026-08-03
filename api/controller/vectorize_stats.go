package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

// VectorizeStatsResponse 向量化可观测统计响应
type VectorizeStatsResponse struct {
	TodayCalls      int64                `json:"today_calls"`
	AvgSpeedMs      int64                `json:"avg_speed_ms"`
	CallsPerMin     float64              `json:"calls_per_min"`
	ChunksToday     int64                `json:"chunks_today"`
	ChunksPerMin    float64              `json:"chunks_per_min"`
	QueuePending    int64                `json:"queue_pending"`
	QueueRetry      int64                `json:"queue_retry"`
	LastCallTs      int64                `json:"last_call_ts"`
	CallTimestamps  []int64              `json:"call_timestamps"`
	ActiveFiles     []ActiveFileInfo     `json:"active_files"`
	RunningTasks    []RunningTaskInfo    `json:"running_tasks"`
	WorkerCount     int                  `json:"worker_count"`
	// 向量存储（Qdrant）写入观测
	VSTodayCalls      int64   `json:"vs_today_calls"`
	VSTodayVectors    int64   `json:"vs_today_vectors"`
	VSAvgSpeedMs      int64   `json:"vs_avg_speed_ms"`
	VSLastCallTs      int64   `json:"vs_last_call_ts"`
	VSCallTimestamps  []int64 `json:"vs_call_timestamps"`
}
// RunningTaskInfo 当前正在处理的任务信息
type RunningTaskInfo struct {
	WorkerName   string                 `json:"worker_name"`
	ChunkID      int64                  `json:"chunk_id"`
	FileID       int64                  `json:"file_id"`
	Step         string                 `json:"step"`
	Steps        map[string]interface{} `json:"steps"`
	StepStartedAt int64                 `json:"step_started_at"`
	StartedAt    int64                  `json:"started_at"`
}

// ActiveFileInfo 活跃文件信息
type ActiveFileInfo struct {
	FileID    int64  `json:"file_id"`
	FileName  string `json:"file_name"`
	Model     string `json:"model"`
	Remaining int    `json:"remaining"`
	StartedAt int64  `json:"started_at"`
}

// GetVectorizeUI godoc
// @Summary 向量化可观测页面
// @Description 向量化可观测性仪表板，可查看今日调用量、队列深度、活跃文件等
// @Tags SystemLog
// @Accept json
// @Produce html
// @Success 200 {string} string "HTML page"
// @Router /api/system_logs/vectorize/ui [get]
func GetVectorizeUI(c *gin.Context) {
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(vectorizeUIHTML))
}

// GetVectorizeStats godoc
// @Summary 向量化可观测统计
// @Description 获取向量化可观测性统计数据，按企业（eid）区分
// @Tags SystemLog
// @Accept json
// @Produce json
// @Param eid query int true "企业ID"
// @Success 200 {object} model.CommonResponse{data=VectorizeStatsResponse}
// @Failure 400 {object} model.CommonResponse
// @Router /api/system_logs/vectorize/stats [get]
func GetVectorizeStats(c *gin.Context) {
	eidStr := c.Query("eid")
	if eidStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(fmt.Errorf("eid 参数必填")))
		return
	}
	eid, err := strconv.ParseInt(eidStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(fmt.Errorf("eid 参数无效: %v", err)))
		return
	}

	ctx := context.Background()
	rdb := common.RDB
	today := time.Now().Format("2006-01-02")

	if !common.IsRedisEnabled() || rdb == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(VectorizeStatsResponse{
			ActiveFiles:  []ActiveFileInfo{},
			RunningTasks: []RunningTaskInfo{},
		}))
		return
	}

	// 初始化响应
	resp := &VectorizeStatsResponse{
		CallTimestamps:   []int64{},
		ActiveFiles:      []ActiveFileInfo{},
		RunningTasks:     []RunningTaskInfo{},
		VSCallTimestamps: []int64{},
	}
	// Pipeline 批量读取 Redis
	pipe := rdb.Pipeline()

	// 今日统计
	pipe.Get(ctx, fmt.Sprintf("rag:emb:obs:%d:calls:%s", eid, today))
	pipe.Get(ctx, fmt.Sprintf("rag:emb:obs:%d:latency:%s", eid, today))
	pipe.Get(ctx, fmt.Sprintf("rag:emb:obs:%d:chunks:%s", eid, today))

	// 队列深度
	pipe.LLen(ctx, fmt.Sprintf("rag:emb:list:%d", eid))
	pipe.ZCard(ctx, fmt.Sprintf("rag:emb:retry:%d", eid))

	// 上次调用时间戳
	pipe.Get(ctx, fmt.Sprintf("rag:emb:obs:%d:last_call_ts", eid))

	// 最近调用时间戳（最近 1 小时）
	callTsKey := fmt.Sprintf("rag:emb:obs:%d:call_timestamps", eid)
	now := float64(time.Now().UnixMilli())
	oneHourAgo := now - 3600000
	pipe.ZRangeByScore(ctx, callTsKey, &redis.ZRangeBy{
		Min: fmt.Sprintf("%f", oneHourAgo),
		Max: fmt.Sprintf("%f", now),
	})

	pipe.SMembers(ctx, fmt.Sprintf("rag:emb:obs:%d:active_set", eid))

	// 向量存储（VS）观测
	pipe.Get(ctx, fmt.Sprintf("rag:emb:vs:%d:calls:%s", eid, today))
	pipe.Get(ctx, fmt.Sprintf("rag:emb:vs:%d:latency:%s", eid, today))
	pipe.Get(ctx, fmt.Sprintf("rag:emb:vs:%d:vectors:%s", eid, today))
	pipe.Get(ctx, fmt.Sprintf("rag:emb:vs:%d:last_call_ts", eid))
	vsTsKey := fmt.Sprintf("rag:emb:vs:%d:call_timestamps", eid)
	pipe.ZRangeByScore(ctx, vsTsKey, &redis.ZRangeBy{
		Min: fmt.Sprintf("%f", oneHourAgo),
		Max: fmt.Sprintf("%f", now),
	})

	// 扫描 worker 任务 key（rag:emb:obs:{eid}:worker:*）
	workerKeys, _ := rdb.Keys(ctx, fmt.Sprintf("rag:emb:obs:%d:worker:*", eid)).Result()
	resp.WorkerCount = len(workerKeys)
	for _, wk := range workerKeys {
		infoStr, err := rdb.Get(ctx, wk).Result()
		if err != nil {
			continue
		}
		var task RunningTaskInfo
		if err := json.Unmarshal([]byte(infoStr), &task); err != nil {
			continue
		}
		task.WorkerName = wk[strings.LastIndex(wk, ":")+1:]
		resp.RunningTasks = append(resp.RunningTasks, task)
	}
	cmds, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		// 部分 key 可能不存在，不报错
	}
	if len(cmds) > 0 {
		if callsStr, err := cmds[0].(*redis.StringCmd).Result(); err == nil {
			resp.TodayCalls, _ = strconv.ParseInt(callsStr, 10, 64)
		}
	}
	if len(cmds) > 1 {
		if latencyStr, err := cmds[1].(*redis.StringCmd).Result(); err == nil {
			totalLatency, _ := strconv.ParseInt(latencyStr, 10, 64)
			if resp.TodayCalls > 0 {
				resp.AvgSpeedMs = totalLatency / resp.TodayCalls
			}
		}
	}
	if len(cmds) > 2 {
		if chunksStr, err := cmds[2].(*redis.StringCmd).Result(); err == nil {
			resp.ChunksToday, _ = strconv.ParseInt(chunksStr, 10, 64)
		}
	}
	if len(cmds) > 3 {
		resp.QueuePending, _ = cmds[3].(*redis.IntCmd).Result()
	}
	if len(cmds) > 4 {
		resp.QueueRetry, _ = cmds[4].(*redis.IntCmd).Result()
	}
	if len(cmds) > 5 {
		if tsStr, err := cmds[5].(*redis.StringCmd).Result(); err == nil {
			resp.LastCallTs, _ = strconv.ParseInt(tsStr, 10, 64)
		}
	}

	// 调用时间戳 + 计算每分钟调用/处理量
	totalChunks := int64(0)
	if len(cmds) > 6 {
		if members, err := cmds[6].(*redis.StringSliceCmd).Result(); err == nil {
			for _, m := range members {
				// member 格式: timestamp:chunkCount
				parts := strings.SplitN(m, ":", 2)
				if len(parts) >= 1 {
					ts, err := strconv.ParseInt(parts[0], 10, 64)
					if err == nil && ts > 0 {
						resp.CallTimestamps = append(resp.CallTimestamps, ts)
						if len(parts) >= 2 {
							cnt, _ := strconv.ParseInt(parts[1], 10, 64)
							totalChunks += cnt
						}
					}
				}
			}
		}
	}
	// 计算每分钟平均调用次数和 chunk 处理量（最近一小时）
	if len(resp.CallTimestamps) >= 2 {
		firstTs := resp.CallTimestamps[0]
		lastTs := resp.CallTimestamps[len(resp.CallTimestamps)-1]
		durationMs := lastTs - firstTs
		if durationMs > 0 {
			calls := len(resp.CallTimestamps) - 1
			resp.CallsPerMin = float64(calls) / (float64(durationMs) / 60000)
			resp.ChunksPerMin = float64(totalChunks) / (float64(durationMs) / 60000)
		}
	}

	// 活跃文件
	if len(cmds) > 7 {
		if fileIDs, err := cmds[7].(*redis.StringSliceCmd).Result(); err == nil {
			for _, fidStr := range fileIDs {
				fid, _ := strconv.ParseInt(fidStr, 10, 64)
				if fid == 0 {
					continue
				}
				activeKey := fmt.Sprintf("rag:emb:obs:%d:active:%d", eid, fid)
				infoStr, err := rdb.Get(ctx, activeKey).Result()
				if err != nil {
					continue
				}
				var info ActiveFileInfo
				if err := json.Unmarshal([]byte(infoStr), &info); err != nil {
					continue
				}
				resp.ActiveFiles = append(resp.ActiveFiles, info)
			}
		}
	}

	// 向量存储（VS）观测结果
	if len(cmds) > 8 {
		if callsStr, err := cmds[8].(*redis.StringCmd).Result(); err == nil {
			resp.VSTodayCalls, _ = strconv.ParseInt(callsStr, 10, 64)
		}
	}
	if len(cmds) > 9 {
		if latencyStr, err := cmds[9].(*redis.StringCmd).Result(); err == nil {
			totalLatency, _ := strconv.ParseInt(latencyStr, 10, 64)
			if resp.VSTodayCalls > 0 {
				resp.VSAvgSpeedMs = totalLatency / resp.VSTodayCalls
			}
		}
	}
	if len(cmds) > 10 {
		if vectorsStr, err := cmds[10].(*redis.StringCmd).Result(); err == nil {
			resp.VSTodayVectors, _ = strconv.ParseInt(vectorsStr, 10, 64)
		}
	}
	if len(cmds) > 11 {
		if tsStr, err := cmds[11].(*redis.StringCmd).Result(); err == nil {
			resp.VSLastCallTs, _ = strconv.ParseInt(tsStr, 10, 64)
		}
	}
	if len(cmds) > 12 {
		if members, err := cmds[12].(*redis.StringSliceCmd).Result(); err == nil {
			for _, m := range members {
				parts := strings.SplitN(m, ":", 2)
				if len(parts) >= 1 {
					ts, err := strconv.ParseInt(parts[0], 10, 64)
					if err == nil && ts > 0 {
						resp.VSCallTimestamps = append(resp.VSCallTimestamps, ts)
					}
				}
			}
		}
	}

	// 按开始时间降序
	sort.Slice(resp.ActiveFiles, func(i, j int) bool {
		return resp.ActiveFiles[i].StartedAt > resp.ActiveFiles[j].StartedAt
	})

	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

const vectorizeUIHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>向量化可观测</title>
  <style>
    :root { --bg:#f5f7fb; --card:#fff; --line:#dde3ea; --text:#1c2633; --muted:#64748b; --brand:#0f766e; --hl:#e6f8f3; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    .wrap { max-width: 1200px; margin: 24px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
    .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
    .stat-card { text-align:center; padding:16px; }
    .stat-value { font-size:28px; font-weight:700; color:var(--brand); }
    .stat-label { font-size:12px; color:var(--muted); margin-top:4px; }
    .status-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .status-msg { font-size:12px; color:var(--muted); }
    .btn-refresh { background:var(--brand); color:#fff; border:none; border-radius:8px; padding:6px 14px; cursor:pointer; font-size:13px; }
    table { width:100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid var(--line); text-align:left; padding:8px; font-size:13px; }
    th { background:#f8fafc; font-size:12px; color:var(--muted); font-weight:600; }
    .tag-active { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; background:#dcfce7; color:#166534; }
    .tag-model { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; background:#e0f2fe; color:#0369a1; }
    .interval-chart { display:flex; align-items:flex-end; gap:2px; height:60px; margin-top:8px; }
    .interval-bar { flex:1; background:var(--brand); border-radius:2px 2px 0 0; min-height:2px; opacity:0.7; }
    .interval-bar:hover { opacity:1; }
    .chart-labels { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); margin-top:4px; }
    @media (max-width: 700px) {
      .grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="status-bar">
        <h2 style="margin:0;">向量化可观测</h2>
        <div>
          <span class="status-msg" id="statusMsg">等待加载</span>
          <button class="btn-refresh" id="refreshBtn">刷新</button>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:12px;color:var(--muted);">鉴权 Token（仅支持 ENV: FILE_LOG_VIEWER_ACCESS_TOKEN）</label>
        <input id="token" placeholder="粘贴 FILE_LOG_VIEWER_ACCESS_TOKEN，刷新后会自动保留" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%;margin-bottom:8px;" />
      </div>
      <div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;">
        <label style="font-size:12px;color:var(--muted);">企业 ID</label>
        <input id="eidInput" type="number" placeholder="输入企业ID" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:200px;" />
        <button id="loadBtn" style="background:var(--brand);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;">加载</button>
      </div>
      <div class="grid" id="statsGrid">
        <div class="card stat-card"><div class="stat-value" id="todayCalls">-</div><div class="stat-label">今日调用（次）</div></div>
        <div class="card stat-card"><div class="stat-value" id="avgSpeed">-</div><div class="stat-label">平均耗时（ms）</div></div>
        <div class="card stat-card"><div class="stat-value" id="callsPerMin">-</div><div class="stat-label">每分钟调用</div></div>
        <div class="card stat-card"><div class="stat-value" id="chunksToday">-</div><div class="stat-label">今日处理 chunk</div></div>
        <div class="card stat-card"><div class="stat-value" id="chunksPerMin">-</div><div class="stat-label">每分钟 chunk</div></div>
        <div class="card stat-card"><div class="stat-value" id="queuePending">-</div><div class="stat-label">排队中</div></div>
        <div class="card stat-card"><div class="stat-value" id="queueRetry">-</div><div class="stat-label">重试中</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;">处理器</h3>
        <span class="status-msg" id="workerCount">-</span>
      </div>
      <div id="processorGrid" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h3 style="margin:0 0 8px 0;">调用间隔</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 6px 0;">每次 API 调用之间的时间间隔（秒），柱越高表示间隔越大，鼠标悬停查看具体值</p>
      <div id="intervalChart" class="interval-chart"></div>
      <div class="chart-labels"><span>最近 60 次调用</span><span id="intervalAvg">-</span></div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h3 style="margin:0 0 8px 0;">向量存储写入（Qdrant）</h3>
      <div class="grid" id="vsStatsGrid">
        <div class="card stat-card"><div class="stat-value" id="vsTodayCalls">-</div><div class="stat-label">今日写入批次</div></div>
        <div class="card stat-card"><div class="stat-value" id="vsAvgSpeed">-</div><div class="stat-label">平均耗时（ms）</div></div>
        <div class="card stat-card"><div class="stat-value" id="vsVectorsToday">-</div><div class="stat-label">今日写入向量</div></div>
        <div class="card stat-card"><div class="stat-value" id="vsLastCall">-</div><div class="stat-label">上次写入</div></div>
      </div>
      <div id="vsIntervalChart" class="interval-chart" style="margin-top:12px;"></div>
      <div class="chart-labels"><span>最近 60 批次写入间隔</span><span id="vsIntervalAvg">-</span></div>
    </div>


    <div class="card" style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;">正在向量化的文件</h3>
        <span class="status-msg" id="activeCount">0 个</span>
      </div>
      <table>
        <thead>
          <tr><th>文件名</th><th>模型</th><th>剩余 chunk</th><th>开始时间</th></tr>
        </thead>
        <tbody id="activeTbody">
          <tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">暂无活跃文件</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const EID_KEY = 'vectorize_obs_eid';
    const TOKEN_KEY = 'vectorize_obs_token';

    const tokenInput = document.getElementById('token');
    tokenInput.value = localStorage.getItem(TOKEN_KEY) || '';
    tokenInput.addEventListener('input', function() {
      const v = tokenInput.value.trim();
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
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

    function init() {
      const saved = localStorage.getItem(EID_KEY);
      if (saved) {
        document.getElementById('eidInput').value = saved;
        loadStats(saved);
      }
    }

    document.getElementById('loadBtn').addEventListener('click', function() {
      const eid = document.getElementById('eidInput').value.trim();
      if (!eid) { alert('请输入企业ID'); return; }
      localStorage.setItem(EID_KEY, eid);
      loadStats(eid);
    });

    document.getElementById('refreshBtn').addEventListener('click', function() {
      const eid = document.getElementById('eidInput').value.trim();
      if (eid) loadStats(eid);
    });

    let autoRefreshTimer = null;

    function startAutoRefresh(eid) {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = setInterval(function() { loadStats(eid, true); }, 5000);
    }

    async function loadStats(eid, silent) {
      if (!silent) {
        document.getElementById('statusMsg').textContent = '加载中...';
      }
      try {
        const p = new URLSearchParams();
        p.set('eid', eid);
        const t = tokenInput.value.trim();
        if (t) p.set('access_token', t);
        const headers = withAuth();
        const resp = await fetch('/api/system_logs/vectorize/stats?' + p.toString(), { headers });
        const json = await resp.json();
        if (!resp.ok || (json && json.success === false)) {
          throw new Error((json && json.message) || ('HTTP ' + resp.status));
        }
        const data = json.data || {};
        renderStats(data);
        document.getElementById('statusMsg').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
        if (!autoRefreshTimer) startAutoRefresh(eid);
      } catch (e) {
        document.getElementById('statusMsg').textContent = '加载失败: ' + (e && e.message ? e.message : e);
        if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      }
    }

    function renderStats(data) {
      document.getElementById('todayCalls').textContent = (data.today_calls || 0).toLocaleString();
      document.getElementById('avgSpeed').textContent = (data.avg_speed_ms || 0).toLocaleString();
      document.getElementById('callsPerMin').textContent = (data.calls_per_min || 0).toFixed(1);
      document.getElementById('chunksToday').textContent = (data.chunks_today || 0).toLocaleString();
      document.getElementById('chunksPerMin').textContent = (data.chunks_per_min || 0).toFixed(1);
      document.getElementById('queuePending').textContent = (data.queue_pending || 0).toLocaleString();
      document.getElementById('queueRetry').textContent = (data.queue_retry || 0).toLocaleString();

      renderProcessorView(data.running_tasks || [], data.worker_count || 0);
      renderIntervalChart(data.call_timestamps || []);
      renderActiveFiles(data.active_files || []);
      renderVSStats(data);
    }

    function renderProcessorView(runningTasks, workerCount) {
      const grid = document.getElementById('processorGrid');
      const total = Math.max(workerCount || 0, 5);
      document.getElementById('workerCount').textContent = '共 ' + total + ' 个 worker';
      grid.innerHTML = '';
      runningTasks.sort(function(a,b) { return a.worker_name.localeCompare(b.worker_name); });
      for (let i = 0; i < total; i++) {
        const task = runningTasks[i];
        const div = document.createElement('div');
        div.style.cssText = 'width:160px;padding:8px;border-radius:8px;font-size:11px;text-align:center;border:1px solid var(--line);';
        if (task) {
          const elapsed = Math.floor((Date.now() - task.started_at) / 1000);
          div.style.background = '#dcfce7';
          div.style.borderColor = '#16a34a';
          // 构建步骤耗时明细
          let stepsHtml = '';
          if (task.steps) {
            const stepNames = Object.keys(task.steps).sort();
            for (const name of stepNames) {
              const ms = task.steps[name];
              stepsHtml += '<div style="color:var(--muted);font-size:10px;">' + name + ': ' + (ms / 1000).toFixed(1) + 's</div>';
            }
          }
          // 当前步骤耗时
          const stepElapsed = task.step_started_at ? Math.floor((Date.now() - task.step_started_at) / 1000) : 0;
          div.innerHTML = '<strong style="color:#166534;">' + (task.step || '运行中') + '</strong>' +
            '<div style="margin-top:4px;color:var(--text);">chunk ' + task.chunk_id + '</div>' +
            '<div style="color:var(--muted);">当前: ' + stepElapsed + 's</div>' +
            stepsHtml;
        } else {
          div.style.background = '#f1f5f9';
          div.style.borderColor = '#dde3ea';
          div.innerHTML = '<strong style="color:#64748b;">空闲</strong>';
        }
        grid.appendChild(div);
      }
    }

    function renderIntervalChart(timestamps) {
      const container = document.getElementById('intervalChart');
      container.innerHTML = '';
      if (timestamps.length < 2) {
        container.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center;">暂无数据（至少需要 2 次 API 调用）</div>';
        document.getElementById('intervalAvg').textContent = '-';
        return;
      }

      const intervals = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i-1]);
      }

      const avg = intervals.reduce(function(a,b) { return a+b; }, 0) / intervals.length;
      document.getElementById('intervalAvg').textContent = '平均 ' + (avg / 1000).toFixed(1) + 's';

      const recent = intervals.slice(-60);
      const maxVal = Math.max.apply(null, recent);
      container.innerHTML = '';
      for (const iv of recent) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;position:relative;';
        const bar = document.createElement('div');
        bar.className = 'interval-bar';
        const pct = Math.max(2, (iv / maxVal) * 100);
        bar.style.height = Math.round(Math.max(2, pct * 0.55)) + 'px';
        bar.style.cursor = 'pointer';
        // 悬停显示 tooltip
        bar.addEventListener('mouseenter', function(e) {
          const tip = wrap.querySelector('.interval-tip');
          if (tip) tip.style.display = 'block';
        });
        bar.addEventListener('mouseleave', function(e) {
          const tip = wrap.querySelector('.interval-tip');
          if (tip) tip.style.display = 'none';
        });
        const tip = document.createElement('div');
        tip.className = 'interval-tip';
        tip.textContent = (iv / 1000).toFixed(1) + 's';
        tip.style.cssText = 'display:none;position:absolute;bottom:100%;background:#1c2633;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;white-space:nowrap;z-index:10;margin-bottom:4px;';
        wrap.appendChild(bar);
        wrap.appendChild(tip);
        container.appendChild(wrap);
      }
    }

    function renderVSStats(data) {
      document.getElementById('vsTodayCalls').textContent = (data.vs_today_calls || 0).toLocaleString();
      document.getElementById('vsAvgSpeed').textContent = (data.vs_avg_speed_ms || 0).toLocaleString();
      document.getElementById('vsVectorsToday').textContent = (data.vs_today_vectors || 0).toLocaleString();
      var lastCall = data.vs_last_call_ts;
      document.getElementById('vsLastCall').textContent = lastCall ? new Date(lastCall).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
      renderVSIntervalChart(data.vs_call_timestamps || []);
    }

    function renderVSIntervalChart(timestamps) {
      var container = document.getElementById('vsIntervalChart');
      container.innerHTML = '';
      if (timestamps.length < 2) {
        container.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center;">暂无数据（至少需要 2 次写入）</div>';
        document.getElementById('vsIntervalAvg').textContent = '-';
        return;
      }
      var intervals = [];
      for (var i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i-1]);
      }
      var avg = intervals.reduce(function(a,b) { return a+b; }, 0) / intervals.length;
      document.getElementById('vsIntervalAvg').textContent = '平均 ' + (avg / 1000).toFixed(1) + 's';
      var recent = intervals.slice(-60);
      var maxVal = Math.max.apply(null, recent);
      container.innerHTML = '';
      for (var j = 0; j < recent.length; j++) {
        var iv = recent[j];
        var wrap = document.createElement('div');
        wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;position:relative;';
        var bar = document.createElement('div');
        bar.className = 'interval-bar';
        var pct = Math.max(2, (iv / maxVal) * 100);
        bar.style.height = Math.round(Math.max(2, pct * 0.55)) + 'px';
        bar.style.cursor = 'pointer';
        bar.addEventListener('mouseenter', function(e) {
          var tip = this.parentElement.querySelector('.interval-tip');
          if (tip) tip.style.display = 'block';
        });
        bar.addEventListener('mouseleave', function(e) {
          var tip = this.parentElement.querySelector('.interval-tip');
          if (tip) tip.style.display = 'none';
        });
        var tip = document.createElement('div');
        tip.className = 'interval-tip';
        tip.textContent = (iv / 1000).toFixed(1) + 's';
        tip.style.cssText = 'display:none;position:absolute;bottom:100%;background:#1c2633;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;white-space:nowrap;z-index:10;margin-bottom:4px;';
        wrap.appendChild(bar);
        wrap.appendChild(tip);
        container.appendChild(wrap);
      }
    }

    function renderActiveFiles(files) {
      const tb = document.getElementById('activeTbody');
      document.getElementById('activeCount').textContent = files.length + ' 个';
      tb.innerHTML = '';
      if (files.length === 0) {
        tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">暂无活跃文件</td></tr>';
        return;
      }
      for (const f of files) {
        const tr = document.createElement('tr');
        const startedAt = f.started_at ? new Date(f.started_at).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
        tr.innerHTML = [
          '<td><strong>' + escapeHtml(f.file_name || 'ID:' + f.file_id) + '</strong></td>',
          '<td><span class="tag-model">' + escapeHtml(f.model || '-') + '</span></td>',
          '<td><span class="tag-active">' + (f.remaining || 0) + ' 个</span></td>',
          '<td style="font-size:12px;">' + startedAt + '</td>'
        ].join('');
        tb.appendChild(tr);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    init();
  </script>
</body>
</html>`