package rag

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type VectorCalibrationPair struct {
	Left  string
	Right string
}

type ThresholdCalibrationResult struct {
	ModelName         string
	ThresholdHigh     int
	ThresholdBalanced int
	ThresholdLoose    int
	SynMean           float64
	UnrelMean         float64
}

type ThresholdCalibrationValues struct {
	High     int
	Balanced int
	Loose    int
}

type ThresholdCalibrationService struct {
	db              *gorm.DB
	chunkConfigSvc   *ChunkConfigService
	embeddingService *EmbeddingService
}

func NewThresholdCalibrationService(db *gorm.DB) *ThresholdCalibrationService {
	return &ThresholdCalibrationService{
		db:              db,
		chunkConfigSvc:   NewChunkConfigService(db),
		embeddingService: NewEmbeddingService(db),
	}
}

var (
	vectorCalibrationSynPairs = []VectorCalibrationPair{
		{Left: "汽车", Right: "轿车"},
		{Left: "购买", Right: "采购"},
		{Left: "医生", Right: "大夫"},
		{Left: "合同", Right: "协议"},
		{Left: "发票", Right: "票据"},
		{Left: "客户", Right: "用户"},
		{Left: "地址", Right: "住址"},
		{Left: "客服", Right: "服务"},
		{Left: "知识库", Right: "文档库"},
	}
	vectorCalibrationUnrelPairs = []VectorCalibrationPair{
		{Left: "天气", Right: "数学"},
		{Left: "苹果", Right: "飞机"},
		{Left: "猫咪", Right: "股票"},
		{Left: "河流", Right: "数据库"},
		{Left: "键盘", Right: "合同"},
		{Left: "香蕉", Right: "流程"},
		{Left: "篮球", Right: "发票"},
		{Left: "海洋", Right: "登录"},
		{Left: "咖啡", Right: "检索"},
	}
)

func (s *ThresholdCalibrationService) RecalculateSiteThreshold(ctx context.Context, eid int64, channelID int64, modelName string) error {
	if modelName == "" {
		return errors.New("model name is empty")
	}

	logger.Infof(ctx, "【阈值校准】开始站点阈值计算: eid=%d, channelID=%d, model=%s", eid, channelID, modelName)

	siteConfig, err := s.chunkConfigSvc.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return fmt.Errorf("获取站点模型配置失败: %w", err)
	}
	if siteConfig.EmbeddingChannelID == nil {
		return errors.New("站点未配置向量模型")
	}
	if *siteConfig.EmbeddingChannelID != channelID {
		logger.Warnf(ctx, "【阈值校准】当前站点向量模型已变化，使用最新配置继续计算: eid=%d, current_channel_id=%d, trigger_channel_id=%d", eid, *siteConfig.EmbeddingChannelID, channelID)
		channelID = *siteConfig.EmbeddingChannelID
	}

	var channel model.Channel
	err = s.db.Where("channel_id = ?", channelID).First(&channel).Error
	if err != nil {
		return fmt.Errorf("获取向量渠道失败: %w", err)
	}
	if channel.Eid != eid {
		return errors.New("向量渠道不属于当前企业")
	}

	synMean, err := s.meanPairSimilarity(ctx, eid, channelID, siteConfig, vectorCalibrationSynPairs)
	if err != nil {
		return fmt.Errorf("计算近义组相似度失败: %w", err)
	}
	unrelMean, err := s.meanPairSimilarity(ctx, eid, channelID, siteConfig, vectorCalibrationUnrelPairs)
	if err != nil {
		return fmt.Errorf("计算无关组相似度失败: %w", err)
	}

	thresholds := calculateThresholds(synMean, unrelMean)
	logger.Infof(ctx, "【阈值校准】计算完成: eid=%d, channelID=%d, model=%s, 近义均值=%.4f, 无关均值=%.4f, threshold_high=%d, threshold_balanced=%d, threshold_loose=%d",
		eid, channelID, modelName, synMean, unrelMean, thresholds.High, thresholds.Balanced, thresholds.Loose)

	updated, err := model.UpsertChannelVectorModelThreshold(channel.CustomConfig, modelName, thresholds.High, thresholds.Balanced, thresholds.Loose)
	if err != nil {
		return fmt.Errorf("更新渠道自定义配置失败: %w", err)
	}
	customConfigJSON, err := model.MarshalChannelCustomConfig(updated)
	if err != nil {
		return fmt.Errorf("序列化渠道自定义配置失败: %w", err)
	}
	channel.CustomConfig = customConfigJSON
	if err := s.db.Save(&channel).Error; err != nil {
		return fmt.Errorf("保存渠道自定义配置失败: %w", err)
	}

	logger.Infof(ctx, "【阈值校准】阈值已写入渠道配置: eid=%d, channelID=%d, model=%s", eid, channelID, modelName)
	return nil
}

func (s *ThresholdCalibrationService) meanPairSimilarity(ctx context.Context, eid int64, channelID int64, config *ChunkConfig, pairs []VectorCalibrationPair) (float64, error) {
	if len(pairs) == 0 {
		return 0, errors.New("calibration pairs are empty")
	}
	scores := make([]float64, 0, len(pairs))
	for _, pair := range pairs {
		leftVector, err := s.embeddingService.GetQueryEmbedding(eid, pair.Left, channelID, config)
		if err != nil {
			return 0, fmt.Errorf("获取文本向量失败(%s): %w", pair.Left, err)
		}
		rightVector, err := s.embeddingService.GetQueryEmbedding(eid, pair.Right, channelID, config)
		if err != nil {
			return 0, fmt.Errorf("获取文本向量失败(%s): %w", pair.Right, err)
		}
		scores = append(scores, cosineSimilarity(leftVector, rightVector))
	}
	return meanFloat64(scores), nil
}

func cosineSimilarity(left, right []float64) float64 {
	if len(left) == 0 || len(right) == 0 || len(left) != len(right) {
		return 0
	}

	var dot, leftNorm, rightNorm float64
	for i := range left {
		dot += left[i] * right[i]
		leftNorm += left[i] * left[i]
		rightNorm += right[i] * right[i]
	}
	if leftNorm == 0 || rightNorm == 0 {
		return 0
	}

	return dot / (math.Sqrt(leftNorm) * math.Sqrt(rightNorm))
}

func meanFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, value := range values {
		sum += value
	}
	return sum / float64(len(values))
}

func calculateThresholds(synMean, unrelMean float64) ThresholdCalibrationValues {
	return ThresholdCalibrationValues{
		High:     calculateThresholdByFactor(synMean, unrelMean, 0.85),
		Balanced: calculateThresholdByFactor(synMean, unrelMean, 0.60),
		Loose:    calculateThresholdByFactor(synMean, unrelMean, 0.30),
	}
}

func calculateThresholdHigh(synMean, unrelMean float64) int {
	return calculateThresholdByFactor(synMean, unrelMean, 0.85)
}

func calculateThresholdByFactor(synMean, unrelMean, factor float64) int {
	raw := unrelMean + factor*(synMean-unrelMean)
	return clampThresholdHigh(int(math.Round(raw * 100)))
}

func clampThresholdHigh(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
