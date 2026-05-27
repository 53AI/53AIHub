package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/wsmanager"
	"github.com/53AI/53AIHub/model"
)

var (
	ErrInvalidAgentID     = errors.New("invalid agent ID format")
	ErrConnectionNotFound = errors.New("connection not found")
	ErrRedisDisabled      = errors.New("Redis is not enabled, feature unavailable")
)

const (
	GracefulDisconnectTimeout = 3 * time.Second
)

// WsAdminService WebSocket 管理服务
type WsAdminService struct{}

// ConnectionInfo 连接信息（用于 API 返回）
type ConnectionInfo struct {
	AgentID         string `json:"agent_id"`
	AgentName       string `json:"agent_name"`
	AgentType       int    `json:"agent_type"`
	ConnectedAt     string `json:"connected_at"`
	DurationSeconds int64  `json:"duration_seconds"`
	LastActive      string `json:"last_active"`
	createdAt       time.Time
}

// DisconnectOptions 断开连接选项
type DisconnectOptions struct {
	Graceful bool   `json:"graceful"`
	Reason   string `json:"reason"`
}

type ConnectionListOptions struct {
	AgentIDFilter string
	Page          int
	PageSize      int
}

// NewWsAdminService 创建 WebSocket 管理服务实例
func NewWsAdminService() *WsAdminService {
	return &WsAdminService{}
}

func (s *WsAdminService) GetConnectionList(ctx context.Context, opts ConnectionListOptions) ([]ConnectionInfo, int64) {
	clients := wsmanager.WsClientManager.GetAllClients()

	if opts.AgentIDFilter != "" {
		agentID, err := hashids.TryParseID(opts.AgentIDFilter)
		if err != nil {
			logger.Warn(ctx, fmt.Sprintf("[ws-admin] Invalid agent ID filter: %s", opts.AgentIDFilter))
			return []ConnectionInfo{}, 0
		}

		client, ok := clients[agentID]
		if !ok {
			return []ConnectionInfo{}, 0
		}

		agentMap := s.batchGetAgentInfo(ctx, []int64{agentID})
		info := buildConnectionInfo(agentID, client, agentMap)
		return []ConnectionInfo{info}, 1
	}

	if len(clients) == 0 {
		return []ConnectionInfo{}, 0
	}

	agentIDs := make([]int64, 0, len(clients))
	for agentID := range clients {
		agentIDs = append(agentIDs, agentID)
	}
	agentMap := s.batchGetAgentInfo(ctx, agentIDs)

	allConnections := make([]ConnectionInfo, 0, len(clients))
	for agentID, client := range clients {
		info := buildConnectionInfo(agentID, client, agentMap)
		allConnections = append(allConnections, info)
	}

	sort.Slice(allConnections, func(i, j int) bool {
		return allConnections[i].createdAt.After(allConnections[j].createdAt)
	})

	total := int64(len(allConnections))

	page := opts.Page
	pageSize := opts.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	start := int64(page-1) * int64(pageSize)
	end := start + int64(pageSize)
	if start >= total {
		return []ConnectionInfo{}, total
	}
	if end > total {
		end = total
	}

	return allConnections[start:end], total
}

func (s *WsAdminService) batchGetAgentInfo(ctx context.Context, agentIDs []int64) map[int64]*agentInfo {
	result := make(map[int64]*agentInfo)
	if len(agentIDs) == 0 {
		return result
	}

	var agents []model.Agent
	if err := model.DB.WithContext(ctx).Select("agent_id, name, agent_type").Where("agent_id IN ?", agentIDs).Find(&agents).Error; err != nil {
		logger.SysError(fmt.Sprintf("[ws-admin] Failed to batch get agent info: %v", err))
		return result
	}

	for i := range agents {
		result[agents[i].AgentID] = &agentInfo{
			name:      agents[i].Name,
			agentType: agents[i].AgentType,
		}
	}
	return result
}

type agentInfo struct {
	name      string
	agentType int
}

func buildConnectionInfo(agentID int64, client *wsmanager.WSClient, agentMap map[int64]*agentInfo) ConnectionInfo {
	createdAt := client.CreatedAt()
	info := ConnectionInfo{
		AgentID:         encodeAgentID(agentID),
		ConnectedAt:     createdAt.Format(time.RFC3339),
		DurationSeconds: int64(time.Since(createdAt).Seconds()),
		LastActive:      client.GetLastActive().Format(time.RFC3339),
		createdAt:       createdAt,
	}

	if agent, ok := agentMap[agentID]; ok {
		info.AgentName = agent.name
		info.AgentType = agent.agentType
	} else {
		info.AgentName = "Unknown"
	}

	return info
}

// GetConnectionMetrics 获取连接统计指标
func (s *WsAdminService) GetConnectionMetrics() wsmanager.WsMetrics {
	return wsmanager.GetMetrics()
}

// DisconnectClient 断开指定连接
func (s *WsAdminService) DisconnectClient(ctx context.Context, adminID int64, agentIDStr string, opts DisconnectOptions) error {
	agentID, err := hashids.TryParseID(agentIDStr)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("[ws-admin] Invalid agent ID format: %s", agentIDStr))
		return ErrInvalidAgentID
	}

	client, ok := wsmanager.WsClientManager.GetClient(agentID)
	if !ok {
		logger.Info(ctx, fmt.Sprintf("[ws-admin] Connection not found for agent: %s", agentIDStr))
		return ErrConnectionNotFound
	}

	logger.Info(ctx, fmt.Sprintf("[ws-admin] Admin %d disconnecting agent %s, graceful=%v, reason=%s",
		adminID, agentIDStr, opts.Graceful, opts.Reason))

	if opts.Graceful {
		go func() {
			timer := time.NewTimer(GracefulDisconnectTimeout)
			defer timer.Stop()

			select {
			case <-timer.C:
				if currentClient, exists := wsmanager.WsClientManager.GetClient(agentID); exists && currentClient == client {
					client.CloseGracefully(opts.Reason)
					logger.Info(context.Background(), fmt.Sprintf("[ws-admin] Graceful disconnect completed for agent %s", agentIDStr))
				}
			case <-client.Done():
				logger.Info(context.Background(), fmt.Sprintf("[ws-admin] Connection already closed for agent %s", agentIDStr))
			}
		}()
	} else {
		client.CloseImmediately(opts.Reason)
	}

	return nil
}

// encodeAgentID 将 int64 agentID 编码为 HashID 字符串
func encodeAgentID(agentID int64) string {
	encoded, _ := hashids.Encode(agentID)
	return encoded
}

type BanOptions struct {
	Duration    time.Duration
	Reason      string
	IsPermanent bool
}

func (s *WsAdminService) BanAgent(ctx context.Context, adminID int64, agentIDStr string, opts BanOptions) error {
	if !common.IsRedisEnabled() {
		return ErrRedisDisabled
	}

	agentID, err := hashids.TryParseID(agentIDStr)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("[ws-admin] Invalid agent ID format: %s", agentIDStr))
		return ErrInvalidAgentID
	}

	key := wsmanager.WsBlacklistKeyPrefix + fmt.Sprintf("%d", agentID)
	value := fmt.Sprintf("%d|%s|%t|%d", time.Now().Unix(), opts.Reason, opts.IsPermanent, adminID)

	var expiration time.Duration
	if opts.IsPermanent {
		expiration = 0
	} else if opts.Duration > 0 {
		expiration = opts.Duration
	} else {
		expiration = 24 * time.Hour
	}

	if err := common.RedisSet(key, value, expiration); err != nil {
		logger.SysError(fmt.Sprintf("[ws-admin] Failed to ban agent %s: %v", agentIDStr, err))
		return fmt.Errorf("failed to ban agent: %v", err)
	}

	if client, ok := wsmanager.WsClientManager.GetClient(agentID); ok {
		client.CloseImmediately("agent banned")
		wsmanager.WsClientManager.RemoveClient(agentID)
	}

	logger.Info(ctx, fmt.Sprintf("[ws-admin] Admin %d banned agent %s, permanent=%v, duration=%v, reason=%s",
		adminID, agentIDStr, opts.IsPermanent, opts.Duration, opts.Reason))
	return nil
}

func (s *WsAdminService) UnbanAgent(ctx context.Context, adminID int64, agentIDStr string) error {
	if !common.IsRedisEnabled() {
		return ErrRedisDisabled
	}

	agentID, err := hashids.TryParseID(agentIDStr)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("[ws-admin] Invalid agent ID format: %s", agentIDStr))
		return ErrInvalidAgentID
	}

	key := wsmanager.WsBlacklistKeyPrefix + fmt.Sprintf("%d", agentID)
	if err := common.RedisDel(key); err != nil {
		logger.SysError(fmt.Sprintf("[ws-admin] Failed to unban agent %s: %v", agentIDStr, err))
		return fmt.Errorf("failed to unban agent: %v", err)
	}

	logger.Info(ctx, fmt.Sprintf("[ws-admin] Admin %d unbanned agent %s", adminID, agentIDStr))
	return nil
}
