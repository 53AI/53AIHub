package model

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// MessageStats 消息统计表，每日一条记录
type MessageStats struct {
	ID              int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid             int64 `json:"eid" gorm:"not null;index"`                // 企业ID
	AgentID         int64 `json:"agent_id" gorm:"not null;index;default:0"` // Agent ID
	StatDate        int64 `json:"stat_date" gorm:"not null;index"`          // 统计日期（时间戳，精确到天）
	TotalQuestions  int64 `json:"total_questions" gorm:"default:0"`         // 问答总数
	NoSearchResults int64 `json:"no_search_results" gorm:"default:0"`       // 未搜索到内容数量
	QuickAnswers    int64 `json:"quick_answers" gorm:"default:0"`           // 快速回答数量
	DeepThinking    int64 `json:"deep_thinking" gorm:"default:0"`           // 深度思考数量
	WebSearchCount  int64 `json:"web_search_count" gorm:"default:0"`        // Web搜索使用数
	TotalTokens     int64 `json:"total_tokens" gorm:"default:0"`            // token消耗总量
	TotalDurationMs int64 `json:"total_duration_ms" gorm:"default:0"`       // 整体耗时(毫秒)
	// 不能冗余统计，因为是需要准确的知道数字（如果按天记录就会出现今天点赞，明天取消的问题），得直接统计表里面的内容
	// SatisfiedCount   int64 `json:"satisfied_count" gorm:"default:0"`   // 满意数
	// UnsatisfiedCount int64 `json:"unsatisfied_count" gorm:"default:0"` // 不满意数
	BaseModel
}

// MessageStatsSummary 统计汇总结果（包含计算字段）
type MessageStatsSummary struct {
	MessageStats
	AvgDurationMs int64 `json:"avg_duration_ms" gorm:"-"` // 平均响应时间(毫秒)，仅汇总时计算返回
	Conversations int64 `json:"conversations" gorm:"-"`   // 对话数量，仅汇总时计算返回
}

// IncrementField 给指定字段增加指定值，如果没有今天的记录就创建新记录
// eid: 企业ID
// agentID: Agent ID
// fieldName: 字段名 (total_questions, no_search_results, quick_answers, deep_thinking, web_search_count, satisfied_count, unsatisfied_count)
// increment: 增加的值，默认为1
func IncrementField(eid int64, agentID int64, fieldName string, increment int64) error {
	// 获取今天的日期时间戳（精确到天，00:00:00）
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	// 使用事务确保操作的原子性
	return DB.Transaction(func(tx *gorm.DB) error {
		// 尝试更新今天的记录
		result := tx.Model(&MessageStats{}).
			Where("eid = ? AND agent_id = ? AND stat_date = ?", eid, agentID, today).
			Updates(map[string]interface{}{
				fieldName:      gorm.Expr(fieldName+" + ?", increment),
				"updated_time": time.Now().UTC().UnixMilli(),
			})

		if result.Error != nil {
			return result.Error
		}

		// 如果没有记录（影响的行数为0），则创建新记录
		if result.RowsAffected == 0 {
			stats := &MessageStats{
				Eid:      eid,
				AgentID:  agentID,
				StatDate: today,
			}

			// 根据字段名设置对应的值
			switch fieldName {
			case "total_questions":
				stats.TotalQuestions = increment
			case "no_search_results":
				stats.NoSearchResults = increment
			case "quick_answers":
				stats.QuickAnswers = increment
			case "deep_thinking":
				stats.DeepThinking = increment
			case "web_search_count":
				stats.WebSearchCount = increment
			case "total_tokens":
				stats.TotalTokens = increment
			case "total_duration_ms":
				stats.TotalDurationMs = increment
				// case "satisfied_count":
				// 	stats.SatisfiedCount = increment
				// case "unsatisfied_count":
				// 	stats.UnsatisfiedCount = increment
			}

			// 尝试创建记录，如果已存在则更新
			// 使用 ON CONFLICT 处理并发情况
			err := tx.Create(stats).Error
			if err != nil {
				// 如果是唯一约束冲突错误，说明记录已经被其他协程创建
				// 此时我们再次尝试更新
				if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
					return tx.Model(&MessageStats{}).
						Where("eid = ? AND agent_id = ? AND stat_date = ?", eid, agentID, today).
						Updates(map[string]interface{}{
							fieldName:      gorm.Expr(fieldName+" + ?", increment),
							"updated_time": time.Now().UTC().UnixMilli(),
						}).Error
				}
				return err
			}
		}

		return nil
	})
}

// GetTodayStats 获取今天的统计数据
func GetTodayStats(eid int64) (*MessageStats, error) {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	var stats MessageStats
	err := DB.Where("eid = ? AND stat_date = ?", eid, today).First(&stats).Error
	if err != nil {
		return nil, err
	}

	return &stats, nil
}

// GetStatsByDateRange 获取指定日期范围的统计数据
func GetStatsByDateRange(eid int64, startDate, endDate time.Time) ([]*MessageStats, error) {
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, startDate.Location()).Unix()
	end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, endDate.Location()).Unix()

	var stats []*MessageStats
	err := DB.Where("eid = ? AND stat_date >= ? AND stat_date <= ?", eid, start, end).
		Order("stat_date ASC").
		Find(&stats).Error

	if err != nil {
		return nil, err
	}

	return stats, nil
}

// SumStatsByDateRange 统计指定日期范围内所有记录的字段总和
func SumStatsByDateRange(eid int64, startDate, endDate time.Time) (*MessageStatsSummary, error) {
	return SumStatsByAgentAndDateRange(eid, nil, startDate, endDate)
}

// SumStatsByAgentAndDateRange 统计指定日期范围内指定 agent 的字段总和
func SumStatsByAgentAndDateRange(eid int64, agentID *int64, startDate, endDate time.Time) (*MessageStatsSummary, error) {
	return SumStatsByAgentDateRangeAndSource(eid, agentID, startDate, endDate, nil)
}

// SumStatsByAgentDateRangeAndSource 统计指定日期范围内指定 agent 和来源的字段总和
// 当 sources 不为空时，从 Message 表实时统计；否则从 MessageStats 表聚合统计
func SumStatsByAgentDateRangeAndSource(eid int64, agentID *int64, startDate, endDate time.Time, sources []string) (*MessageStatsSummary, error) {
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, startDate.Location()).Unix()
	end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, endDate.Location()).Unix()
	startMs := start * 1000
	endMs := end * 1000

	var stats MessageStatsSummary
	stats.Eid = eid
	if agentID != nil {
		stats.AgentID = *agentID
	}

	if len(sources) > 0 {
		query := DB.Model(&Message{}).
			Where("eid = ? AND created_time >= ? AND created_time <= ?", eid, startMs, endMs)

		if agentID != nil {
			query = query.Where("agent_id = ?", *agentID)
		}

		query = query.Where("request_source IN ?", sources)

		type aggResult struct {
			TotalQuestions int64
			QuickAnswers   int64
			DeepThinking   int64
			TotalTokens    int64
			TotalDuration  int64
			Conversations  int64
		}

		var result aggResult
		err := query.Select("COUNT(*) as total_questions, "+
			"SUM(CASE WHEN thinking_mode = ? THEN 1 ELSE 0 END) as quick_answers, "+
			"SUM(CASE WHEN thinking_mode = ? THEN 1 ELSE 0 END) as deep_thinking, "+
			"SUM(total_tokens) as total_tokens, "+
			"SUM(elapsed_time) as total_duration, "+
			"COUNT(DISTINCT conversation_id) as conversations",
			ThinkingModeQuick, ThinkingModeDeep).
			Scan(&result).Error

		if err != nil {
			return nil, err
		}

		stats.TotalQuestions = result.TotalQuestions
		stats.QuickAnswers = result.QuickAnswers
		stats.DeepThinking = result.DeepThinking
		stats.TotalTokens = result.TotalTokens
		stats.TotalDurationMs = result.TotalDuration
		stats.Conversations = result.Conversations

		if stats.TotalQuestions > 0 {
			stats.AvgDurationMs = stats.TotalDurationMs / stats.TotalQuestions
		}
	} else {
		query := DB.Model(&MessageStats{}).
			Select("SUM(total_questions) as total_questions, SUM(no_search_results) as no_search_results, "+
				"SUM(quick_answers) as quick_answers, SUM(deep_thinking) as deep_thinking, "+
				"SUM(web_search_count) as web_search_count, SUM(total_tokens) as total_tokens, "+
				"SUM(total_duration_ms) as total_duration_ms").
			Where("eid = ? AND stat_date >= ? AND stat_date <= ?", eid, start, end)

		if agentID != nil {
			query = query.Where("agent_id = ?", *agentID)
		}

		err := query.Find(&stats).Error
		if err != nil {
			return nil, err
		}

		if stats.TotalQuestions > 0 {
			stats.AvgDurationMs = stats.TotalDurationMs / stats.TotalQuestions
		}

		convQuery := DB.Model(&Message{}).
			Select("COUNT(DISTINCT conversation_id)").
			Where("eid = ? AND created_time >= ? AND created_time <= ?", eid, startMs, endMs)

		if agentID != nil {
			convQuery = convQuery.Where("agent_id = ?", *agentID)
		}

		err = convQuery.Scan(&stats.Conversations).Error
		if err != nil {
			return nil, err
		}
	}

	return &stats, nil
}

// SumStatsBetweenDates 统计两个日期之间所有记录的字段总和
func SumStatsBetweenDates(eid int64, startDate, endDate time.Time) (*MessageStatsSummary, error) {
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, startDate.Location()).Unix()
	end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, endDate.Location()).Unix()

	var stats MessageStatsSummary
	err := DB.Model(&MessageStats{}).
		Select("SUM(total_questions) as total_questions, SUM(no_search_results) as no_search_results, "+
			"SUM(quick_answers) as quick_answers, SUM(deep_thinking) as deep_thinking, "+
			"SUM(web_search_count) as web_search_count, SUM(total_tokens) as total_tokens, "+
			"SUM(total_duration_ms) as total_duration_ms").
		Where("eid = ? AND stat_date >= ? AND stat_date <= ?", eid, start, end).
		Find(&stats).Error

	if err != nil {
		return nil, err
	}

	stats.Eid = eid
	if stats.TotalQuestions > 0 {
		stats.AvgDurationMs = stats.TotalDurationMs / stats.TotalQuestions
	}
	return &stats, nil
}
