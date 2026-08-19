package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type GlobalStatItem struct {
	Today     int64 `json:"today"`
	Yesterday int64 `json:"yesterday"`
}

type FileStatItem struct {
	Today          int64 `json:"today"`
	Yesterday      int64 `json:"yesterday"`
	TotalSize      int64 `json:"totalSize"`
	YesterdaySize  int64 `json:"yesterdaySize"`
}
type RecordingDetailItem struct {
	Total     GlobalStatItem `json:"total"`
	Duration  GlobalStatItem `json:"duration"`
	FileSize  GlobalStatItem `json:"fileSize"`
	Parsed    GlobalStatItem `json:"parsed"`
	Pending   GlobalStatItem `json:"pending"`
	Failed    GlobalStatItem `json:"failed"`
	Insights  GlobalStatItem `json:"insights"`
}

type GlobalStatsResponse struct {
	GeneratedAt       string              `json:"generatedAt"`
	Spaces            GlobalStatItem      `json:"spaces"`
	Libraries         GlobalStatItem      `json:"libraries"`
	Files             FileStatItem        `json:"files"`
	Enterprises       GlobalStatItem      `json:"enterprises"`
	Members           GlobalStatItem      `json:"members"`
	Visitors          GlobalStatItem      `json:"visitors"`
	Recordings        RecordingDetailItem `json:"recordings"`
	Conversations     GlobalStatItem      `json:"conversations"`
	Messages          GlobalStatItem      `json:"messages"`
	Agents            GlobalStatItem      `json:"agents"`
	Skills            GlobalStatItem      `json:"skills"`
	DAU               GlobalStatItem      `json:"dau"`
	ActiveEnterprises GlobalStatItem      `json:"activeEnterprises"`
}

// ComputeGlobalStats 计算全平台统计数据，不依赖 HTTP 上下文
func ComputeGlobalStats() GlobalStatsResponse {
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayStartMs := todayStart.UnixMilli()
	yesterdayStartMs := todayStart.Add(-24 * time.Hour).UnixMilli()
	tomorrowStartMs := todayStart.Add(24 * time.Hour).UnixMilli()

	db := model.DB
	var resp GlobalStatsResponse
	resp.GeneratedAt = now.Format(time.RFC3339)

	// 1. Spaces
	db.Model(&model.Space{}).Count(&resp.Spaces.Today)
	db.Model(&model.Space{}).Where("created_time < ?", todayStartMs).Count(&resp.Spaces.Yesterday)

	// 2. Libraries
	db.Model(&model.Library{}).Count(&resp.Libraries.Today)
	db.Model(&model.Library{}).Where("created_time < ?", todayStartMs).Count(&resp.Libraries.Yesterday)

	// 3. Files (包含已删除)
	db.Model(&model.File{}).Count(&resp.Files.Today)
	db.Model(&model.File{}).Where("created_time < ?", todayStartMs).Count(&resp.Files.Yesterday)
	db.Model(&model.File{}).
		Select("COALESCE(SUM(uf.size), 0)").
		Joins("LEFT JOIN upload_files uf ON uf.id = files.upload_file_id").
		Scan(&resp.Files.TotalSize)
	db.Model(&model.File{}).
		Select("COALESCE(SUM(uf.size), 0)").
		Joins("LEFT JOIN upload_files uf ON uf.id = files.upload_file_id").
		Where("files.created_time < ?", todayStartMs).
		Scan(&resp.Files.YesterdaySize)

	// 4. Enterprises
	db.Model(&model.Enterprise{}).Count(&resp.Enterprises.Today)
	db.Model(&model.Enterprise{}).Where("created_time < ?", todayStartMs).Count(&resp.Enterprises.Yesterday)

	// 5. Members (全部用户)
	db.Model(&model.User{}).Count(&resp.Members.Today)
	db.Model(&model.User{}).Where("created_time < ?", todayStartMs).Count(&resp.Members.Yesterday)

	// 6. Visitors (非内部成员: type = 1, Registered user)
	db.Model(&model.User{}).Where("type = ?", model.UserTypeRegistered).Count(&resp.Visitors.Today)
	db.Model(&model.User{}).Where("type = ? AND created_time < ?", model.UserTypeRegistered, todayStartMs).Count(&resp.Visitors.Yesterday)

	// 7. Recordings (录音文件: origin_type in recording types)
	recordingTypes := model.RecordingOriginTypes()
	db.Model(&model.File{}).Where("origin_type IN ?", recordingTypes).Count(&resp.Recordings.Total.Today)
	db.Model(&model.File{}).Where("origin_type IN ? AND created_time < ?", recordingTypes, todayStartMs).Count(&resp.Recordings.Total.Yesterday)

	// 录音总时长
	db.Model(&model.File{}).Select("COALESCE(SUM(duration_ms), 0)").Where("origin_type IN ?", recordingTypes).Scan(&resp.Recordings.Duration.Today)
	db.Model(&model.File{}).Select("COALESCE(SUM(duration_ms), 0)").Where("origin_type IN ? AND created_time < ?", recordingTypes, todayStartMs).Scan(&resp.Recordings.Duration.Yesterday)

	// 录音文件大小
	db.Model(&model.File{}).Select("COALESCE(SUM(uf.size), 0)").Joins("LEFT JOIN upload_files uf ON uf.id = files.upload_file_id").Where("files.origin_type IN ?", recordingTypes).Scan(&resp.Recordings.FileSize.Today)
	db.Model(&model.File{}).Select("COALESCE(SUM(uf.size), 0)").Joins("LEFT JOIN upload_files uf ON uf.id = files.upload_file_id").Where("files.origin_type IN ? AND files.created_time < ?", recordingTypes, todayStartMs).Scan(&resp.Recordings.FileSize.Yesterday)

	// 录音转写状态
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ?", recordingTypes, "normal").Count(&resp.Recordings.Parsed.Today)
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ? AND created_time < ?", recordingTypes, "normal", todayStartMs).Count(&resp.Recordings.Parsed.Yesterday)
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ?", recordingTypes, "pending").Count(&resp.Recordings.Pending.Today)
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ? AND created_time < ?", recordingTypes, "pending", todayStartMs).Count(&resp.Recordings.Pending.Yesterday)
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ?", recordingTypes, "failed").Count(&resp.Recordings.Failed.Today)
	db.Model(&model.File{}).Where("origin_type IN ? AND parsing_status = ? AND created_time < ?", recordingTypes, "failed", todayStartMs).Count(&resp.Recordings.Failed.Yesterday)

	// 录音洞察摘要数
	db.Model(&model.File{}).Where("origin_type IN ? AND insight_summary != ''", recordingTypes).Count(&resp.Recordings.Insights.Today)
	db.Model(&model.File{}).Where("origin_type IN ? AND insight_summary != '' AND created_time < ?", recordingTypes, todayStartMs).Count(&resp.Recordings.Insights.Yesterday)
	// 8. Conversations
	db.Model(&model.Conversation{}).Count(&resp.Conversations.Today)
	db.Model(&model.Conversation{}).Where("created_time < ?", todayStartMs).Count(&resp.Conversations.Yesterday)

	// 9. Messages
	db.Model(&model.Message{}).Count(&resp.Messages.Today)
	db.Model(&model.Message{}).Where("created_time < ?", todayStartMs).Count(&resp.Messages.Yesterday)

	// 10. Agents
	db.Model(&model.Agent{}).Count(&resp.Agents.Today)
	db.Model(&model.Agent{}).Where("created_time < ?", todayStartMs).Count(&resp.Agents.Yesterday)

	// 11. Skills (skill_libraries)
	db.Model(&model.SkillLibrary{}).Count(&resp.Skills.Today)
	db.Model(&model.SkillLibrary{}).Where("created_time < ?", todayStartMs).Count(&resp.Skills.Yesterday)

	// 12. DAU (有 API 活跃记录的用户)
	db.Model(&model.User{}).Where("last_login_time >= ? AND last_login_time < ?", todayStartMs, tomorrowStartMs).Count(&resp.DAU.Today)
	db.Model(&model.User{}).Where("last_login_time >= ? AND last_login_time < ?", yesterdayStartMs, todayStartMs).Count(&resp.DAU.Yesterday)

	// 13. Active Enterprises (有活跃用户的企业)
	db.Model(&model.User{}).
		Select("COUNT(DISTINCT eid)").
		Where("last_login_time >= ? AND last_login_time < ?", todayStartMs, tomorrowStartMs).
		Scan(&resp.ActiveEnterprises.Today)
	db.Model(&model.User{}).
		Select("COUNT(DISTINCT eid)").
		Where("last_login_time >= ? AND last_login_time < ?", yesterdayStartMs, todayStartMs).
		Scan(&resp.ActiveEnterprises.Yesterday)

	return resp
}

// GetGlobalStats 返回全平台全局统计数据
// GET /api/admin/platform/global-stats
func GetGlobalStats(c *gin.Context) {
	resp := ComputeGlobalStats()
	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// PushGlobalStatsToKeystone 计算全局统计并推送到 Keystone
func PushGlobalStatsToKeystone() {
	endpoint := config.KEYSTONE_ENDPOINT
	if endpoint == "" {
		logger.SysLogf("PushGlobalStatsToKeystone: KEYSTONE_ENDPOINT 未配置，跳过")
		return
	}
	secret := config.KEYSTONE_SECRET
	if secret == "" {
		logger.SysLogf("PushGlobalStatsToKeystone: KEYSTONE_SECRET 未配置，跳过")
		return
	}

	stats := ComputeGlobalStats()
	body, err := json.Marshal(stats)
	if err != nil {
		logger.SysLogf("PushGlobalStatsToKeystone: 序列化失败: %v", err)
		return
	}

	url := fmt.Sprintf("%s/api/v1/webhooks/km-stats", endpoint)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		logger.SysLogf("PushGlobalStatsToKeystone: 创建请求失败: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-KM-Secret", secret)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logger.SysLogf("PushGlobalStatsToKeystone: 请求失败: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.SysLogf("PushGlobalStatsToKeystone: 非预期状态码 %d", resp.StatusCode)
		return
	}
	logger.SysLogf("PushGlobalStatsToKeystone: 推送成功")
}

// StartGlobalStatsPushWorker 启动全局统计定时推送 Worker
// 每 interval 分钟推送一次
func StartGlobalStatsPushWorker(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	go func() {
		logger.SysLogf("StartGlobalStatsPushWorker: 启动，间隔 %v", interval)
		// 启动后立即推送一次
		PushGlobalStatsToKeystone()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				PushGlobalStatsToKeystone()
			case <-ctx.Done():
				logger.SysLogf("StartGlobalStatsPushWorker: 停止")
				return
			}
		}
	}()
}