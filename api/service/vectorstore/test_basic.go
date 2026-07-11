package vectorstore

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/songquanpeng/one-api/common/logger"
)

// TestBasicFunctionality 测试基本功能
func TestBasicFunctionality() error {
	logger.SysLogf("=== 测试向量数据库驱动基本功能 ===")

	// 1. 测试配置加载
	logger.SysLogf("1. 测试配置加载...")
	config := LoadFromEnv()
	if err := config.Validate(); err != nil {
		return fmt.Errorf("配置验证失败: %v", err)
	}
	logger.SysLogf("   配置类型: %s, 端点: %s", config.Type, config.Endpoint)

	// 2. 测试向量存储创建
	logger.SysLogf("2. 测试向量存储创建...")
	store, err := NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("创建向量存储失败: %v", err)
	}
	logger.SysLogf("   向量存储类型: %s", store.Type())

	// 3. 测试连接
	logger.SysLogf("3. 测试连接...")
	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接失败: %v", err)
	}
	logger.SysLogf("   连接成功")

	// 4. 测试健康检查
	logger.SysLogf("4. 测试健康检查...")
	if err := store.HealthCheck(ctx); err != nil {
		return fmt.Errorf("健康检查失败: %v", err)
	}
	logger.SysLogf("   健康检查通过")

	// 5. 测试集合操作
	logger.SysLogf("5. 测试集合操作...")
	testCollection := "test_collection_" + fmt.Sprintf("%d", time.Now().Unix())

	// 创建测试集合
	collectionConfig := CollectionConfig{
		Name:      testCollection,
		Dimension: 3,
		Metric:    "cosine",
		IndexType: "HNSW",
	}

	if err := store.CreateCollection(ctx, collectionConfig); err != nil {
		return fmt.Errorf("创建集合失败: %v", err)
	}
	logger.SysLogf("   创建集合成功: %s", testCollection)

	// 检查集合是否存在（通过获取集合信息的方式）
	_, err = store.GetCollectionInfo(ctx, testCollection)
	if err != nil {
		if vsErr, ok := err.(*VectorStoreError); ok && vsErr.Code == ErrCodeCollectionNotFound {
			return fmt.Errorf("集合应该存在但获取信息失败")
		}
		return fmt.Errorf("获取集合信息失败: %v", err)
	}
	logger.SysLogf("   集合存在检查通过")

	// 6. 测试向量操作
	logger.SysLogf("6. 测试向量操作...")

	// 插入测试向量
	testVectors := []VectorRecord{
		{
			ID:     1,
			Vector: []float32{1.0, 0.0, 0.0},
			Metadata: map[string]interface{}{
				"content": "测试向量1",
				"type":    "test",
			},
		},
		{
			ID:     2,
			Vector: []float32{0.0, 1.0, 0.0},
			Metadata: map[string]interface{}{
				"content": "测试向量2",
				"type":    "test",
			},
		},
	}

	if err := store.Insert(ctx, testCollection, testVectors); err != nil {
		return fmt.Errorf("插入向量失败: %v", err)
	}
	logger.SysLogf("   插入 %d 个向量成功", len(testVectors))

	// 7. 测试搜索功能
	logger.SysLogf("7. 测试搜索功能...")
	searchReq := SearchRequest{
		Collection: testCollection,
		Vector:     []float32{1.0, 0.0, 0.0},
		TopK:       2,
	}

	searchResp, err := store.Search(ctx, searchReq)
	if err != nil {
		return fmt.Errorf("搜索失败: %v", err)
	}
	logger.SysLogf("   搜索返回 %d 个结果，延迟: %v", len(searchResp.Results), searchResp.Latency)

	// 8. 测试获取向量
	logger.SysLogf("8. 测试获取向量...")
	vectors, err := store.Get(ctx, testCollection, []interface{}{1})
	if err != nil {
		return fmt.Errorf("获取向量失败: %v", err)
	}
	if len(vectors) != 1 {
		return fmt.Errorf("期望获取1个向量，实际获取%d个", len(vectors))
	}
	logger.SysLogf("   获取向量成功: ID=%v", vectors[0].ID)

	// 9. 测试统计信息
	logger.SysLogf("9. 测试统计信息...")
	stats, err := store.GetStats(ctx)
	if err != nil {
		return fmt.Errorf("获取统计信息失败: %v", err)
	}
	logger.SysLogf("   集合数量: %d, 总向量数: %d, 状态: %s",
		stats.Collections, stats.TotalVectors, stats.Status)

	// 10. 清理测试数据
	logger.SysLogf("10. 清理测试数据...")
	if err := store.DeleteCollection(ctx, testCollection); err != nil {
		logger.SysLogf("   警告: 删除测试集合失败: %v", err)
	} else {
		logger.SysLogf("   测试集合删除成功")
	}

	// 11. 断开连接
	logger.SysLogf("11. 断开连接...")
	if err := store.Disconnect(ctx); err != nil {
		return fmt.Errorf("断开连接失败: %v", err)
	}
	logger.SysLogf("   断开连接成功")

	logger.SysLogf("=== 所有测试通过! ===")
	return nil
}

// RunTest 运行测试
func RunTest() {
	// 加载环境变量
	if _, err := os.Stat(".envkm"); err == nil {
		// 如果存在.envkm文件，则加载它
		if err := godotenv.Load(".envkm"); err != nil {
			logger.SysLogf("警告: 加载.envkm文件失败: %v", err)
		}
	}

	// 设置测试环境变量（如果未设置）
	if os.Getenv("VECTOR_DB_TYPE") == "" {
		os.Setenv("VECTOR_DB_TYPE", "qdrant")
	}
	if os.Getenv("VECTOR_DB_URL") == "" {
		os.Setenv("VECTOR_DB_URL", "http://localhost:6333")
	}
	if os.Getenv("VECTOR_DB_API_KEY") == "" {
		os.Setenv("VECTOR_DB_API_KEY", "difyai123456")
	}

	if err := TestBasicFunctionality(); err != nil {
		logger.SysLogf("测试失败: %v", err)
		os.Exit(1)
	}
}

// TestEmbeddingServiceIntegration 测试EmbeddingService集成
func TestEmbeddingServiceIntegration() error {
	logger.SysLogf("=== 测试EmbeddingService集成 ===")

	// 这里可以添加EmbeddingService的集成测试
	// 由于需要数据库连接，暂时跳过
	logger.SysLogf("EmbeddingService集成测试需要数据库连接，暂时跳过")

	return nil
}

// BenchmarkVectorOperations 向量操作性能基准测试
func BenchmarkVectorOperations(vectorCount int, dimension int) error {
	logger.SysLogf("=== 性能基准测试: %d个%d维向量 ===", vectorCount, dimension)

	config := LoadFromEnv()
	store, err := NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("创建向量存储失败: %v", err)
	}

	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接失败: %v", err)
	}
	defer store.Disconnect(ctx)

	testCollection := "benchmark_collection_" + fmt.Sprintf("%d", time.Now().Unix())

	// 创建集合
	collectionConfig := CollectionConfig{
		Name:      testCollection,
		Dimension: dimension,
		Metric:    "cosine",
		IndexType: "HNSW",
	}

	if err := store.CreateCollection(ctx, collectionConfig); err != nil {
		return fmt.Errorf("创建集合失败: %v", err)
	}
	defer store.DeleteCollection(ctx, testCollection)

	// 生成测试向量
	vectors := make([]VectorRecord, vectorCount)
	for i := 0; i < vectorCount; i++ {
		vector := make([]float32, dimension)
		for j := 0; j < dimension; j++ {
			vector[j] = float32(i*dimension + j)
		}
		vectors[i] = VectorRecord{
			ID:     i + 1,
			Vector: vector,
			Metadata: map[string]interface{}{
				"index": i,
			},
		}
	}

	// 测试批量插入性能
	logger.SysLogf("插入 %d 个向量...", vectorCount)
	startTime := time.Now()
	if err := store.BatchInsert(ctx, testCollection, vectors); err != nil {
		return fmt.Errorf("批量插入失败: %v", err)
	}
	insertDuration := time.Since(startTime)
	insertThroughput := float64(vectorCount) / insertDuration.Seconds()

	logger.SysLogf("插入完成: 耗时 %v, 吞吐量 %.2f vectors/sec", insertDuration, insertThroughput)

	// 测试搜索性能
	logger.SysLogf("测试搜索性能...")
	searchVector := vectors[0].Vector
	searchCount := 100

	startTime = time.Now()
	for i := 0; i < searchCount; i++ {
		searchReq := SearchRequest{
			Collection: testCollection,
			Vector:     searchVector,
			TopK:       10,
		}
		_, err := store.Search(ctx, searchReq)
		if err != nil {
			return fmt.Errorf("搜索失败: %v", err)
		}
	}
	searchDuration := time.Since(startTime)
	avgSearchLatency := searchDuration / time.Duration(searchCount)
	searchThroughput := float64(searchCount) / searchDuration.Seconds()

	logger.SysLogf("搜索完成: 平均延迟 %v, 吞吐量 %.2f queries/sec", avgSearchLatency, searchThroughput)

	return nil
}
