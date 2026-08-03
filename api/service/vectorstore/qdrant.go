package vectorstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// QdrantStore Qdrant向量数据库适配器
// https://github.com/qdrant/qdrant/blob/master/docs/redoc/master/openapi.json
type QdrantStore struct {
	config    *VectorDBConfig
	client    *http.Client
	connected bool
	mu        sync.RWMutex
	buffer    *VectorInsertBuffer // 向量插入缓冲器
}

// NewQdrantStore 创建Qdrant存储实例
func NewQdrantStore(config *VectorDBConfig) *QdrantStore {
	store := &QdrantStore{
		config: config,
		client: &http.Client{
			Timeout: config.ConnectionTimeout,
		},
	}
	// 自动启动缓冲器（如果配置启用）
	if config.EnableBuffer {
		bufferConfig := &VectorBufferConfig{
			EnableBuffer:  config.EnableBuffer,
			BatchSize:     config.BatchSize,
			FlushWindow:   config.FlushWindow,
			MaxBufferSize: config.MaxBufferSize,
		}
		store.StartBuffer(bufferConfig)
	}
	return store
}

// StartBuffer 启动向量插入缓冲器
func (q *QdrantStore) StartBuffer(config *VectorBufferConfig) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.buffer != nil {
		q.buffer.Stop()
	}

	q.buffer = NewVectorInsertBuffer(q, config)
	q.buffer.Start()
	logger.SysLogf("✅ Qdrant向量插入缓冲器已启动")
}

// StopBuffer 停止向量插入缓冲器
func (q *QdrantStore) StopBuffer() {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.buffer != nil {
		q.buffer.Stop()
		q.buffer = nil
		logger.SysLogf("✅ Qdrant向量插入缓冲器已停止")
	}
}

// VectorBufferConfig 向量缓冲配置
type VectorBufferConfig struct {
	EnableBuffer  bool          `json:"enable_buffer" yaml:"enable_buffer"`     // 是否启用缓冲
	BatchSize     int           `json:"batch_size" yaml:"batch_size"`           // 批量大小
	FlushWindow   time.Duration `json:"flush_window" yaml:"flush_window"`       // 刷新窗口
	MaxBufferSize int           `json:"max_buffer_size" yaml:"max_buffer_size"` // 单 Collection 最大缓冲
}

// DefaultVectorBufferConfig 默认向量缓冲配置
func DefaultVectorBufferConfig() *VectorBufferConfig {
	return &VectorBufferConfig{
		EnableBuffer:  true,
		BatchSize:     100,
		FlushWindow:   3 * time.Second,
		MaxBufferSize: 5000,
	}
}

// BufferedInsert 缓冲的插入请求
type BufferedInsert struct {
	Collection string            // 集合名称
	Vector     VectorRecord      // 向量记录
	signal     *batchSignal      // 批量共享信号（DoneChan + doneOnce）
	Err        error             // 存储结果错误（单个向量）
	batchErr   *batchErrorHolder // 批量共享错误持有者（可选）
}

// NewBufferedInsert 创建缓冲的插入请求（用于测试）
func NewBufferedInsert(collection string, vector VectorRecord) *BufferedInsert {
	return &BufferedInsert{
		Collection: collection,
		Vector:     vector,
		signal:     newBatchSignal(),
	}
}

// Done 安全地关闭完成通道
func (bi *BufferedInsert) Done(err error) {
	bi.Err = err
	// 如果有批量错误持有者，设置错误
	if bi.batchErr != nil {
		bi.batchErr.Set(err)
	}
	// 关闭共享信号
	if bi.signal != nil {
		bi.signal.Close()
	}
}

// WaitChan 返回等待通道
func (bi *BufferedInsert) WaitChan() <-chan struct{} {
	if bi.signal != nil {
		return bi.signal.Done()
	}
	return nil
}

// CollectionBuffer 按 Collection 分组的缓冲
type CollectionBuffer struct {
	vectors      []VectorRecord    // 缓冲的向量列表
	callbacks    []*BufferedInsert // 关联的回调列表
	firstAddTime time.Time         // 首次加入时间（用于超时刷新）
}

// batchSignal 批量完成的信号
// 用于在共享 DoneChan 的批量插入中安全地关闭通道
type batchSignal struct {
	doneChan chan struct{}
	doneOnce sync.Once
}

// newBatchSignal 创建批量信号
func newBatchSignal() *batchSignal {
	return &batchSignal{
		doneChan: make(chan struct{}),
	}
}

// Close 安全地关闭完成通道
func (s *batchSignal) Close() {
	s.doneOnce.Do(func() {
		close(s.doneChan)
	})
}

// Done 返回完成通道
func (s *batchSignal) Done() <-chan struct{} {
	return s.doneChan
}

// batchErrorHolder 批量插入的错误持有者
// 用于在共享 DoneChan 的批量插入中传递错误
type batchErrorHolder struct {
	err atomic.Pointer[error]
}

// Set 设置错误（只记录第一个错误）
func (h *batchErrorHolder) Set(err error) {
	// 使用原子操作，只设置第一个错误
	errPtr := &err
	h.err.CompareAndSwap(nil, errPtr)
}

// Get 获取错误
func (h *batchErrorHolder) Get() error {
	if ptr := h.err.Load(); ptr != nil {
		return *ptr
	}
	return nil
}

// VectorInsertBuffer 向量插入缓冲器
type VectorInsertBuffer struct {
	store         *QdrantStore                 // 关联的 QdrantStore
	batchChan     chan *BufferedInsert         // 接收插入请求的 channel
	buffers       map[string]*CollectionBuffer // 按 collection 分组的缓冲
	batchSize     int                          // 批量大小阈值
	flushWindow   time.Duration                // 刷新时间窗口
	maxBufferSize int                          // 单 Collection 最大缓冲数
	mu            sync.Mutex                   // 保护 buffers
	flushMu       sync.Mutex                   // 保护 flush 操作，防止并发刷新同一 collection
	ctx           context.Context              // 上下文
	cancel        context.CancelFunc           // 取消函数
	wg            sync.WaitGroup               // 等待组
	enabled       atomic.Bool                  // 是否启用（使用原子操作）
}

// NewVectorInsertBuffer 创建向量插入缓冲器
func NewVectorInsertBuffer(store *QdrantStore, config *VectorBufferConfig) *VectorInsertBuffer {
	if config == nil {
		config = DefaultVectorBufferConfig()
	}

	// 配置验证
	if config.BatchSize <= 0 {
		config.BatchSize = 100
	}
	if config.FlushWindow <= 0 {
		config.FlushWindow = 3 * time.Second
	}
	if config.MaxBufferSize <= 0 {
		config.MaxBufferSize = 5000
	}

	ctx, cancel := context.WithCancel(context.Background())
	b := &VectorInsertBuffer{
		store:         store,
		batchChan:     make(chan *BufferedInsert, config.BatchSize*10),
		buffers:       make(map[string]*CollectionBuffer),
		batchSize:     config.BatchSize,
		flushWindow:   config.FlushWindow,
		maxBufferSize: config.MaxBufferSize,
		ctx:           ctx,
		cancel:        cancel,
	}
	b.enabled.Store(config.EnableBuffer)
	return b
}

// Start 启动缓冲器后台处理
func (b *VectorInsertBuffer) Start() {
	if !b.enabled.Load() {
		return
	}
	b.wg.Add(1)
	go b.runLoop()
	logger.SysLogf("🚀 向量插入缓冲器已启动 (batch_size=%d, flush_window=%v)", b.batchSize, b.flushWindow)
}

// Stop 停止缓冲器
// 使用 stopOnce 保证只停止一次，避免重复调用阻塞
func (b *VectorInsertBuffer) Stop() {
	// 检查是否已停止
	if !b.enabled.Load() {
		return
	}

	if b.cancel != nil {
		b.cancel()
	}

	// 带超时的等待，防止死锁
	done := make(chan struct{})
	go func() {
		b.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// 正常退出
	case <-time.After(35 * time.Second): // 比HTTP超时多5秒
		logger.SysLogf("⚠️ 缓冲器停止超时，强制退出")
	}

	b.enabled.Store(false)
	logger.SysLogf("🛑 向量插入缓冲器已停止")
}

// runLoop 缓冲器主循环
func (b *VectorInsertBuffer) runLoop() {
	defer b.wg.Done()

	ticker := time.NewTicker(b.flushWindow)
	defer ticker.Stop()

	for {
		select {
		case <-b.ctx.Done():
			// 先排空 channel 中剩余的请求，防止数据丢失
			b.drainChannel()
			// 优雅关闭时刷新所有缓冲
			b.flushAll()
			return
		case insert := <-b.batchChan:
			b.addToBuffer(insert)
		case <-ticker.C:
			b.flushExpired()
		}
	}
}

// drainChannel 排空 channel 中剩余的请求
func (b *VectorInsertBuffer) drainChannel() {
	for {
		select {
		case insert := <-b.batchChan:
			b.addToBuffer(insert)
		default:
			return
		}
	}
}

// addToBuffer 将向量添加到缓冲
func (b *VectorInsertBuffer) addToBuffer(insert *BufferedInsert) {
	var shouldFlush string

	b.mu.Lock()
	buf, exists := b.buffers[insert.Collection]
	if !exists {
		buf = &CollectionBuffer{
			vectors:      make([]VectorRecord, 0, b.batchSize),
			callbacks:    make([]*BufferedInsert, 0, b.batchSize),
			firstAddTime: time.Now(), // 记录首次加入时间
		}
		b.buffers[insert.Collection] = buf
	}

	buf.vectors = append(buf.vectors, insert.Vector)
	buf.callbacks = append(buf.callbacks, insert)

	// 如果 firstAddTime 为零（刚刷新过），重新设置
	if buf.firstAddTime.IsZero() {
		buf.firstAddTime = time.Now()
	}

	// 达到批量阈值或最大缓冲数时标记需要刷新
	if len(buf.vectors) >= b.batchSize || len(buf.vectors) >= b.maxBufferSize {
		shouldFlush = insert.Collection
	}
	b.mu.Unlock()

	// 在锁外调用 flushCollection，避免锁重入问题
	if shouldFlush != "" {
		b.flushCollection(shouldFlush)
	}
}

// flushCollection 刷新指定 collection 的缓冲
// 使用 flushMu 防止同一 collection 被多个 goroutine 并发刷新
func (b *VectorInsertBuffer) flushCollection(collection string) {
	// 使用 flushMu 保护，防止并发刷新同一 collection
	b.flushMu.Lock()
	defer b.flushMu.Unlock()

	b.mu.Lock()
	buf, exists := b.buffers[collection]
	if !exists || len(buf.vectors) == 0 {
		b.mu.Unlock()
		return
	}

	// 取出缓冲数据并清空
	vectors := buf.vectors
	callbacks := buf.callbacks
	buf.vectors = make([]VectorRecord, 0, b.batchSize)
	buf.callbacks = make([]*BufferedInsert, 0, b.batchSize)
	buf.firstAddTime = time.Time{} // 重置时间
	b.mu.Unlock()

	// 执行批量插入（使用 context.Background() 确保关闭时也能写入）
	// 这样即使缓冲器正在关闭，也会尽力将数据写入
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	err := b.store.doBatchInsert(ctx, collection, vectors)
	elapsed := time.Since(start).Milliseconds()

	// 可观测：记录向量存储写入
	if observer := GetBatchFlushObserver(); observer != nil && len(vectors) > 0 {
		if eidVal, ok := vectors[0].Metadata["eid"]; ok {
			switch v := eidVal.(type) {
			case int64:
				observer(v, len(vectors), elapsed)
			case float64:
				observer(int64(v), len(vectors), elapsed)
			case int:
				observer(int64(v), len(vectors), elapsed)
			}
		}
	}

	// 通知所有等待的调用方（使用安全的 Done 方法）
	for _, cb := range callbacks {
		cb.Done(err)
	}
}

// flushAll 刷新所有缓冲
func (b *VectorInsertBuffer) flushAll() {
	b.mu.Lock()
	collections := make([]string, 0, len(b.buffers))
	for col := range b.buffers {
		collections = append(collections, col)
	}
	b.mu.Unlock()

	for _, col := range collections {
		b.flushCollection(col)
	}
}

// flushExpired 刷新超时的缓冲
func (b *VectorInsertBuffer) flushExpired() {
	b.mu.Lock()
	var toFlush []string
	now := time.Now()

	// 基于 firstAddTime 检查是否需要刷新
	for col, buf := range b.buffers {
		if !buf.firstAddTime.IsZero() && now.Sub(buf.firstAddTime) >= b.flushWindow && len(buf.vectors) > 0 {
			toFlush = append(toFlush, col)
		}
	}
	b.mu.Unlock()

	// 同步刷新（避免并发问题）
	for _, col := range toFlush {
		b.flushCollection(col)
	}
}

// Flush 手动刷新所有缓冲
func (b *VectorInsertBuffer) Flush() {
	b.flushAll()
}

// IsEnabled 检查缓冲器是否启用
func (b *VectorInsertBuffer) IsEnabled() bool {
	return b.enabled.Load()
}

// Insert 通过缓冲器插入向量
// 优化：使用单个 batchSignal 处理整个批次，减少大量 channel 创建的开销
// lazy: 不等待 Qdrant flush 完成，推送即返回。如果 Qdrant 写入失败，向量丢失但 chunk 状态显示 normal
func (b *VectorInsertBuffer) Insert(ctx context.Context, collection string, vectors []VectorRecord) error {
	if len(vectors) == 0 {
		return nil
	}

	// 创建批量共享的信号和错误持有者
	signal := newBatchSignal()
	batchErrHolder := &batchErrorHolder{}

	// 发送所有向量到缓冲 channel，推完即返回，不等待 flush
	for _, v := range vectors {
		insert := &BufferedInsert{
			Collection: collection,
			Vector:     v,
			signal:     signal,
			batchErr:   batchErrHolder,
		}

		select {
		case b.batchChan <- insert:
		case <-ctx.Done():
			return ctx.Err()
		case <-b.ctx.Done():
			return errors.New("buffer closed")
		}
	}

	return nil
}

// Type 返回存储类型
func (q *QdrantStore) Type() string {
	return "qdrant"
}

// Connect 连接到Qdrant
func (q *QdrantStore) Connect(ctx context.Context) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.config.VerboseLogging {
		logger.SysLogf("🔗 尝试连接到 Qdrant: %s", q.config.Endpoint)
	}

	// HTTP接口无需维护连接状态，直接标记为已连接
	// 实际网络问题会在具体HTTP请求时报错
	q.connected = true

	if q.config.VerboseLogging {
		logger.SysLogf("✅ 成功连接到 Qdrant: %s", q.config.Endpoint)
	}
	return nil
}

// Disconnect 断开连接
func (q *QdrantStore) Disconnect(ctx context.Context) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	// 停止缓冲器
	if q.buffer != nil {
		q.buffer.Stop()
		q.buffer = nil
	}

	q.connected = false
	logger.SysLogf("Disconnected from Qdrant")
	return nil
}

// IsConnected 检查连接状态
func (q *QdrantStore) IsConnected() bool {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.connected
}

// HealthCheck 健康检查
func (q *QdrantStore) HealthCheck(ctx context.Context) error {
	url := fmt.Sprintf("%s/", q.config.Endpoint)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant健康检查请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: GET")
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return err
	}

	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return NewVectorStoreError(ErrCodeConnectionFailed, "failed to connect to Qdrant", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 健康检查失败，响应内容: %s", formattedResp)
		return fmt.Errorf("health check failed with status: %d", resp.StatusCode)
	}

	if q.config.VerboseLogging {
		logger.SysLogf("✅ 健康检查通过")
	}
	return nil
}

// CreateCollection 创建集合
func (q *QdrantStore) CreateCollection(ctx context.Context, config CollectionConfig) error {
	// 构建Qdrant创建集合请求
	reqBody := map[string]interface{}{
		"vectors": map[string]interface{}{
			"size":     config.Dimension,
			"distance": q.convertMetric(config.Metric),
		},
	}

	// 添加索引参数
	if config.IndexParams != nil {
		if indexConfig, ok := config.IndexParams["hnsw"]; ok {
			reqBody["hnsw_config"] = indexConfig
		}
	}

	// 添加分片配置
	if config.ShardNum > 0 {
		reqBody["shard_number"] = config.ShardNum
	}
	if config.ReplicaNum > 0 {
		reqBody["replication_factor"] = config.ReplicaNum
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return NewVectorStoreError(ErrCodeInvalidConfig, "failed to marshal request", err.Error())
	}

	collectionName := q.config.GetCollectionName(config.Name)
	url := fmt.Sprintf("%s/collections/%s", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant创建集合请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: PUT")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(jsonData)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return NewVectorStoreError(ErrCodeConnectionFailed, "failed to create collection", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode == http.StatusConflict {
		logger.SysLogf("❌ 集合已存在: %s", config.Name)
		return NewVectorStoreError(ErrCodeCollectionExists, "collection already exists", config.Name)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		lower := strings.ToLower(formattedResp)
		if resp.StatusCode == http.StatusBadRequest && strings.Contains(lower, "already exists") && strings.Contains(lower, "collection") {
			logger.SysLogf("❌ 集合已存在: %s", config.Name)
			return NewVectorStoreError(ErrCodeCollectionExists, "collection already exists", config.Name)
		}
		logger.SysLogf("❌ 创建集合失败，响应内容: %s", formattedResp)
		return NewVectorStoreError(ErrCodeUnknown, "failed to create collection", formattedResp)
	}

	logger.SysLogf("✅ 创建集合成功: %s", config.Name)
	return nil
}

// DeleteCollection 删除集合
func (q *QdrantStore) DeleteCollection(ctx context.Context, name string) error {
	collectionName := q.config.GetCollectionName(name)
	url := fmt.Sprintf("%s/collections/%s", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant删除集合请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: DELETE")
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return err
	}

	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return NewVectorStoreError(ErrCodeConnectionFailed, "failed to delete collection", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode == http.StatusNotFound {
		logger.SysLogf("❌ 集合不存在: %s", name)
		return NewVectorStoreError(ErrCodeCollectionNotFound, "collection not found", name)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 删除集合失败，响应内容: %s", formattedResp)
		return NewVectorStoreError(ErrCodeUnknown, "failed to delete collection", formattedResp)
	}

	logger.SysLogf("✅ 删除集合成功: %s", name)
	return nil
}

// GetCollectionInfo 获取集合信息
func (q *QdrantStore) GetCollectionInfo(ctx context.Context, name string) (*CollectionInfo, error) {
	collectionName := q.config.GetCollectionName(name)
	url := fmt.Sprintf("%s/collections/%s", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant获取集合信息请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: GET")
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return nil, err
	}

	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to get collection info", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode == http.StatusNotFound {
		logger.SysLogf("❌ 集合不存在: %s", name)
		return nil, NewVectorStoreError(ErrCodeCollectionNotFound, "collection not found", name)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 获取集合信息失败，响应内容: %s", formattedResp)
		return nil, NewVectorStoreError(ErrCodeUnknown, "failed to get collection info", formattedResp)
	}

	var response struct {
		Result struct {
			Status string `json:"status"`
			Config struct {
				Params struct {
					Vectors struct {
						Size     int    `json:"size"`
						Distance string `json:"distance"`
					} `json:"vectors"`
				} `json:"params"`
			} `json:"config"`
			PointsCount int64 `json:"points_count"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ Get响应解析失败: %v, 响应内容: %s", err, formattedResp)
		return nil, err
	}

	info := &CollectionInfo{
		Name:        name,
		Dimension:   response.Result.Config.Params.Vectors.Size,
		Metric:      q.convertMetricFromQdrant(response.Result.Config.Params.Vectors.Distance),
		VectorCount: response.Result.PointsCount,
		Status:      response.Result.Status,
		CreatedAt:   time.Now(), // Qdrant不提供创建时间，使用当前时间
		UpdatedAt:   time.Now(),
	}

	return info, nil
}

// ListCollections 列出所有集合
func (q *QdrantStore) ListCollections(ctx context.Context) ([]string, error) {
	url := fmt.Sprintf("%s/collections", q.config.Endpoint)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant列出集合请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: GET")
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return nil, err
	}

	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to list collections", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 列出集合失败，响应内容: %s", formattedResp)
		return nil, NewVectorStoreError(ErrCodeUnknown, "failed to list collections", formattedResp)
	}

	var response struct {
		Result struct {
			Collections []struct {
				Name string `json:"name"`
			} `json:"collections"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		logger.SysLogf("❌ 响应解析失败: %v", err)
		return nil, err
	}

	collections := make([]string, 0, len(response.Result.Collections))
	for _, collection := range response.Result.Collections {
		// 去除前缀
		name := q.config.StripCollectionPrefix(collection.Name)
		collections = append(collections, name)
	}

	return collections, nil
}

// convertMetric 转换距离度量
func (q *QdrantStore) convertMetric(metric string) string {
	switch metric {
	case "cosine":
		return "Cosine"
	case "euclidean":
		return "Euclid"
	case "dot":
		return "Dot"
	default:
		return "Cosine"
	}
}

// convertMetricFromQdrant 从Qdrant格式转换距离度量
func (q *QdrantStore) convertMetricFromQdrant(metric string) string {
	switch metric {
	case "Cosine":
		return "cosine"
	case "Euclid":
		return "euclidean"
	case "Dot":
		return "dot"
	default:
		return "cosine"
	}
}

// Insert 插入向量记录
func (q *QdrantStore) Insert(ctx context.Context, collection string, vectors []VectorRecord) error {
	// 检查是否启用缓冲器
	q.mu.RLock()
	buffer := q.buffer
	q.mu.RUnlock()

	if buffer != nil && buffer.IsEnabled() {
		return buffer.Insert(ctx, collection, vectors)
	}
	return q.BatchInsert(ctx, collection, vectors)
}

// BatchInsert 批量插入向量记录
func (q *QdrantStore) BatchInsert(ctx context.Context, collection string, vectors []VectorRecord) error {
	return q.doBatchInsert(ctx, collection, vectors)
}

// doBatchInsert 执行批量插入向量记录的实际逻辑
func (q *QdrantStore) doBatchInsert(ctx context.Context, collection string, vectors []VectorRecord) error {
	if len(vectors) == 0 {
		return nil
	}

	// 转换向量记录格式为PointsList格式
	points := make([]map[string]interface{}, len(vectors))
	for i, vector := range vectors {
		// 确保向量值是浮点数，即使它们在数值上等于整数
		floatVector := make([]float64, len(vector.Vector))
		for j, v := range vector.Vector {
			float64Val := float64(v)
			// 强制序列化为浮点数，即使数值上等于整数
			if float64Val == float64(int64(float64Val)) {
				floatVector[j] = float64Val + 0.0 // 添加0.0确保JSON序列化为浮点数
			} else {
				floatVector[j] = float64Val
			}
		}

		points[i] = map[string]interface{}{
			"id":      vector.ID, // 使用int类型的ID
			"vector":  floatVector,
			"payload": vector.Metadata,
		}
	}

	// 根据Qdrant API规范，使用PointsList格式
	reqBody := map[string]interface{}{
		"points": points,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return NewVectorStoreError(ErrCodeInvalidVector, "failed to marshal vectors", err.Error())
	}

	collectionName := q.config.GetCollectionName(collection)
	url := fmt.Sprintf("%s/collections/%s/points?wait=true", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant批量插入向量请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: PUT")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(jsonData)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return NewVectorStoreError(ErrCodeConnectionFailed, "failed to insert vectors", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))

		// 根据状态码返回不同的错误类型
		switch resp.StatusCode {
		case http.StatusNotFound:
			// 集合不存在
			logger.SysLogf("❌ 集合不存在: %s", collection)
			return NewVectorStoreError(ErrCodeCollectionNotFound, "collection not found", collection)
		default:
			logger.SysLogf("❌ 插入向量失败，响应内容: %s", formattedResp)
			return NewVectorStoreError(ErrCodeInsertFailed, "failed to insert vectors", formattedResp)
		}
	}

	logger.SysLogf("✅ 批量插入向量成功，数量: %d, 集合: %s", len(vectors), collection)
	return nil
}

// Update 更新向量记录
func (q *QdrantStore) Update(ctx context.Context, collection string, vectors []VectorRecord) error {
	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant更新向量请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📝 请求方法: Update")
		logger.SysLogf("│ 📦 请求参数: %d 条向量记录", len(vectors))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	// Qdrant的更新操作与插入相同，会覆盖已存在的记录
	return q.BatchInsert(ctx, collection, vectors)
}

// Delete 删除向量记录
func (q *QdrantStore) Delete(ctx context.Context, collection string, ids []interface{}) error {
	if len(ids) == 0 {
		return nil
	}

	reqBody := map[string]interface{}{
		"points": ids,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return NewVectorStoreError(ErrCodeInvalidConfig, "failed to marshal delete request", err.Error())
	}

	collectionName := q.config.GetCollectionName(collection)
	url := fmt.Sprintf("%s/collections/%s/points/delete", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant删除向量请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: POST")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(jsonData)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return NewVectorStoreError(ErrCodeConnectionFailed, "failed to delete vectors", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		formattedResp := logger.FormatErrorResp(string(body))

		// 如果是集合不存在的错误，则只记录警告而不返回错误
		if strings.Contains(formattedResp, "doesn't exist") {
			logger.SysLogf("⚠️ 集合不存在，跳过删除操作: %s", formattedResp)
			return nil
		}

		logger.SysLogf("❌ 删除向量失败，响应内容: %s", formattedResp)
		return NewVectorStoreError(ErrCodeDeleteFailed, "failed to delete vectors", formattedResp)
	}

	logger.SysLogf("✅ 删除向量成功，数量: %d, 集合: %s", len(ids), collection)
	return nil
}

// Get 获取向量记录
func (q *QdrantStore) Get(ctx context.Context, collection string, ids []interface{}) ([]VectorRecord, error) {
	if len(ids) == 0 {
		return []VectorRecord{}, nil
	}

	// 将interface{}类型的ID转换为uint64类型
	uintIds := make([]uint64, len(ids))
	for i, id := range ids {
		switch v := id.(type) {
		case string:
			if numID, err := strconv.ParseUint(v, 10, 64); err == nil {
				uintIds[i] = numID
			} else {
				// 如果无法转换为uint64，则跳过
				continue
			}
		case int:
			uintIds[i] = uint64(v)
		case float64:
			uintIds[i] = uint64(v)
		case int64:
			uintIds[i] = uint64(v)
		}
	}

	reqBody := map[string]interface{}{
		"ids":          uintIds,
		"with_payload": true,
		"with_vector":  true,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeInvalidConfig, "failed to marshal get request", err.Error())
	}

	collectionName := q.config.GetCollectionName(collection)
	url := fmt.Sprintf("%s/collections/%s/points", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant获取向量请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: POST")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(jsonData)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to get vectors", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		errorResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 获取向量失败，响应内容: %s", errorResp)
		return nil, NewVectorStoreError(ErrCodeUnknown, "failed to get vectors", errorResp)
	}

	var response struct {
		Result []struct {
			ID      interface{}            `json:"id"`
			Vector  []float32              `json:"vector"`
			Payload map[string]interface{} `json:"payload"`
		} `json:"result"`
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysLogf("❌ 读取响应体失败: %v", err)
		return nil, err
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		logger.SysLogf("❌ 响应解析失败: %v", err)
		return nil, err
	}

	vectors := make([]VectorRecord, len(response.Result))
	for i, point := range response.Result {
		vectors[i] = VectorRecord{
			ID:       point.ID,
			Vector:   point.Vector,
			Metadata: point.Payload,
		}
	}

	return vectors, nil
}

// Search 向量搜索
func (q *QdrantStore) Search(ctx context.Context, req SearchRequest) (*SearchResponse, error) {
	startTime := time.Now()

	collectionName := q.config.GetCollectionName(req.Collection)
	url := fmt.Sprintf("%s/collections/%s/points/search", q.config.Endpoint, collectionName)

	// 构建搜索请求
	searchReq := map[string]interface{}{
		"vector":       req.Vector,
		"limit":        req.TopK,
		"with_payload": true,
		"with_vector":  false,
	}

	// 添加分数阈值
	if req.ScoreThreshold > 0 {
		searchReq["score_threshold"] = req.ScoreThreshold
	}

	// 添加过滤条件
	if len(req.Filters) > 0 {
		searchReq["filter"] = q.buildFilter(req.Filters, req.Query)
	}

	// 添加搜索参数
	if len(req.SearchParams) > 0 {
		if ef, ok := req.SearchParams["ef"]; ok {
			searchReq["params"] = map[string]interface{}{
				"hnsw_ef": ef,
			}
		}
	}

	// 创建一个用于日志打印的请求副本，限制vector显示长度
	logSearchReq := make(map[string]interface{})
	for k, v := range searchReq {
		logSearchReq[k] = v
	}
	logSearchReq["vector"] = q.formatVectorForLog(req.Vector)

	// 将logSearchReq转换为JSON格式
	logSearchReqJSON, err := json.Marshal(logSearchReq)
	if err != nil {
		logger.SysLogf("❌ 无法将请求参数转换为JSON格式: %v", err)
		return nil, err
	}

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant向量搜索请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: POST")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(logSearchReqJSON)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	jsonData, err := json.Marshal(searchReq)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeInvalidVector, "failed to marshal search request", err.Error())
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		httpReq.Header.Set("api-key", q.config.APIKey)
	}

	logger.SysDebugf("【Qdrant请求】向量搜索请求: collection=%s, top_k=%d, has_filter=%t, has_params=%t",
		req.Collection, req.TopK, len(req.Filters) > 0, len(req.SearchParams) > 0)
	resp, err := q.client.Do(httpReq)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to search vectors", err.Error())
	}
	defer resp.Body.Close()

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotFound {
		errorResp := logger.FormatErrorResp(string(respBody))
		logger.SysLogf("❌ 集合不存在: %s", req.Collection)
		return nil, NewVectorStoreError(ErrCodeCollectionNotFound, "collection not found", errorResp)
	}
	if resp.StatusCode != http.StatusOK {
		errorResp := logger.FormatErrorResp(string(respBody))
		logger.SysLogf("❌ 搜索失败，响应内容: %s", errorResp)
		return nil, NewVectorStoreError(ErrCodeSearchFailed, "search failed: "+errorResp, errorResp)
	}

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("│ 📦 响应内容: %s", logger.FormatLogParams(string(respBody)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	var response struct {
		Result []struct {
			ID      interface{}            `json:"id"`
			Score   float32                `json:"score"`
			Payload map[string]interface{} `json:"payload"`
		} `json:"result"`
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		return nil, err
	}

	// 转换搜索结果
	results := make([]SearchResult, len(response.Result))
	for i, point := range response.Result {
		// 保持原始ID格式，支持UUID字符串和数字两种格式
		var id interface{}
		switch v := point.ID.(type) {
		case string:
			// 如果是纯数字字符串，转换为int；否则保持字符串格式（支持UUID）
			if numID, err := strconv.Atoi(v); err == nil {
				id = numID
			} else {
				// 保持原始字符串格式（支持UUID）
				id = v
			}
		case int:
			id = v
		case float64:
			id = int(v)
		default:
			// 其他类型保持原样
			id = v
		}

		results[i] = SearchResult{
			ID:       id,
			Score:    point.Score,
			Metadata: point.Payload,
		}
	}

	logger.SysDebugf("【Qdrant请求】向量搜索完成: collection=%s, top_k=%d, result_count=%d, elapsed_ms=%d",
		req.Collection, req.TopK, len(results), time.Since(startTime).Milliseconds())

	return &SearchResponse{
		Results: results,
		Total:   len(results),
		Latency: time.Since(startTime),
	}, nil
}

// SearchBatch 批量向量搜索
func (q *QdrantStore) SearchBatch(ctx context.Context, req BatchSearchRequest) ([]SearchResponse, error) {
	startTime := time.Now()

	if len(req.Searches) == 0 {
		return nil, fmt.Errorf("search batch is empty")
	}

	collectionName := q.config.GetCollectionName(req.Collection)
	url := fmt.Sprintf("%s/collections/%s/points/search/batch", q.config.Endpoint, collectionName)

	searches := make([]map[string]interface{}, 0, len(req.Searches))
	for _, item := range req.Searches {
		searchReq := map[string]interface{}{
			"vector":       item.Vector,
			"limit":        item.TopK,
			"with_payload": true,
			"with_vector":  false,
		}

		if item.ScoreThreshold > 0 {
			searchReq["score_threshold"] = item.ScoreThreshold
		}

		if len(item.Filters) > 0 {
			searchReq["filter"] = q.buildFilter(item.Filters, item.Query)
		}

		if len(item.SearchParams) > 0 {
			if ef, ok := item.SearchParams["ef"]; ok {
				searchReq["params"] = map[string]interface{}{
					"hnsw_ef": ef,
				}
			}
		}

		searches = append(searches, searchReq)
	}

	batchReq := map[string]interface{}{
		"searches": searches,
	}

	logBatchReq := map[string]interface{}{
		"searches": make([]map[string]interface{}, 0, len(req.Searches)),
	}
	for i, item := range searches {
		logItem := make(map[string]interface{})
		for k, v := range item {
			logItem[k] = v
		}
		logItem["vector"] = q.formatVectorForLog(req.Searches[i].Vector)
		logBatchReq["searches"] = append(logBatchReq["searches"].([]map[string]interface{}), logItem)
	}

	if q.config.VerboseLogging {
		logJSON, err := json.Marshal(logBatchReq)
		if err != nil {
			logger.SysLogf("❌ 无法将批量请求参数转换为JSON格式: %v", err)
			return nil, err
		}
		logger.SysLogf("=====\n🚀 Qdrant批量向量搜索请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: POST")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(logJSON)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	jsonData, err := json.Marshal(batchReq)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeInvalidVector, "failed to marshal batch search request", err.Error())
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		httpReq.Header.Set("api-key", q.config.APIKey)
	}

	logger.SysDebugf("【Qdrant请求】批量向量搜索请求: collection=%s, batch_size=%d", req.Collection, len(req.Searches))
	resp, err := q.client.Do(httpReq)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to search vectors", err.Error())
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotFound {
		errorResp := logger.FormatErrorResp(string(respBody))
		logger.SysLogf("❌ 集合不存在: %s", req.Collection)
		return nil, NewVectorStoreError(ErrCodeCollectionNotFound, "collection not found", errorResp)
	}
	if resp.StatusCode != http.StatusOK {
		errorResp := logger.FormatErrorResp(string(respBody))
		logger.SysLogf("❌ 批量搜索失败，响应内容: %s", errorResp)
		return nil, NewVectorStoreError(ErrCodeSearchFailed, "batch search failed: "+errorResp, errorResp)
	}

	var response struct {
		Result [][]struct {
			ID      interface{}            `json:"id"`
			Score   float32                `json:"score"`
			Payload map[string]interface{} `json:"payload"`
		} `json:"result"`
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		return nil, err
	}

	results := make([]SearchResponse, len(response.Result))
	for i, batchResult := range response.Result {
		items := make([]SearchResult, len(batchResult))
		for j, point := range batchResult {
			var id interface{}
			switch v := point.ID.(type) {
			case string:
				if numID, err := strconv.Atoi(v); err == nil {
					id = numID
				} else {
					id = v
				}
			case int:
				id = v
			case float64:
				id = int(v)
			default:
				id = v
			}

			items[j] = SearchResult{
				ID:       id,
				Score:    point.Score,
				Metadata: point.Payload,
			}
		}

		results[i] = SearchResponse{
			Results: items,
			Total:   len(items),
			Latency: time.Since(startTime),
		}
	}

	resultCounts := make([]int, len(results))
	totalResults := 0
	for i, result := range results {
		resultCounts[i] = len(result.Results)
		totalResults += len(result.Results)
	}
	logger.SysDebugf("【Qdrant请求】批量向量搜索完成: collection=%s, batch_size=%d, total_results=%d, result_counts=%v, elapsed_ms=%d",
		req.Collection, len(req.Searches), totalResults, resultCounts, time.Since(startTime).Milliseconds())

	return results, nil
}

// HybridSearch 混合搜索（暂不支持，返回向量搜索结果）
func (q *QdrantStore) HybridSearch(ctx context.Context, req HybridSearchRequest) (*SearchResponse, error) {
	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant混合搜索请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📝 请求方法: HybridSearch")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(fmt.Sprintf("%+v", req)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	if req.VectorQuery == nil {
		return nil, NewVectorStoreError(ErrCodeInvalidConfig, "vector query is required for hybrid search", "")
	}

	// 转换为普通搜索请求
	searchReq := SearchRequest{
		Collection:     req.Collection,
		Vector:         req.VectorQuery.Vector,
		TopK:           req.TopK,
		ScoreThreshold: req.ScoreThreshold,
		Filters:        req.Filters,
		OutputFields:   req.OutputFields,
	}

	return q.Search(ctx, searchReq)
}

// FilterSearch 过滤搜索
func (q *QdrantStore) FilterSearch(ctx context.Context, req FilterSearchRequest) (*SearchResponse, error) {
	startTime := time.Now()

	// 构建过滤搜索请求
	searchReq := map[string]interface{}{
		"limit":        req.TopK,
		"with_payload": true,
		"with_vector":  false,
	}

	// 添加过滤条件
	if len(req.Filters) > 0 {
		searchReq["filter"] = q.buildFilter(req.Filters, "")
	}

	jsonData, err := json.Marshal(searchReq)
	if err != nil {
		return nil, NewVectorStoreError(ErrCodeInvalidConfig, "failed to marshal filter search request", err.Error())
	}

	collectionName := q.config.GetCollectionName(req.Collection)
	url := fmt.Sprintf("%s/collections/%s/points/scroll", q.config.Endpoint, collectionName)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant过滤搜索请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: POST")
		logger.SysLogf("│ 📦 请求参数: %s", logger.FormatLogParams(string(jsonData)))
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if q.config.APIKey != "" {
		httpReq.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(httpReq)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to filter search", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		errorResp := logger.FormatErrorResp(string(body))
		logger.SysLogf("❌ 过滤搜索失败，响应内容: %s", errorResp)
		return nil, NewVectorStoreError(ErrCodeSearchFailed, "filter search failed", errorResp)
	}

	var response struct {
		Result struct {
			Points []struct {
				ID      interface{}            `json:"id"`
				Payload map[string]interface{} `json:"payload"`
			} `json:"points"`
		} `json:"result"`
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysLogf("❌ 读取响应体失败: %v", err)
		return nil, err
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		logger.SysLogf("❌ 响应解析失败: %v", err)
		return nil, err
	}

	// 转换搜索结果
	results := make([]SearchResult, len(response.Result.Points))
	for i, point := range response.Result.Points {
		// 尝试将interface{}类型的ID转换为int
		id := 0
		switch v := point.ID.(type) {
		case string:
			if numID, err := strconv.Atoi(v); err == nil {
				id = numID
			}
		case int:
			id = v
		case float64:
			id = int(v)
		}

		results[i] = SearchResult{
			ID:       id,
			Score:    1.0, // 过滤搜索没有分数
			Metadata: point.Payload,
		}
	}

	return &SearchResponse{
		Results: results,
		Total:   len(results),
		Latency: time.Since(startTime),
	}, nil
}

// formatVectorForLog 格式化向量用于日志打印，限制显示长度
func (q *QdrantStore) formatVectorForLog(vector interface{}) interface{} {
	if v, ok := vector.([]float64); ok {
		vectorStr := fmt.Sprintf("%v", v)
		if len(vectorStr) > 100 {
			return vectorStr[:100] + "... (total:" + fmt.Sprintf("%d", len(v)) + ")"
		}
		return vectorStr
	}
	if v, ok := vector.([]float32); ok {
		vectorStr := fmt.Sprintf("%v", v)
		if len(vectorStr) > 100 {
			return vectorStr[:100] + "... (total:" + fmt.Sprintf("%d", len(v)) + ")"
		}
		return vectorStr
	}
	return vector
}

// buildFilter 构建Qdrant过滤条件
func (q *QdrantStore) buildFilter(filters map[string]interface{}, query string) map[string]interface{} {
	if len(filters) == 0 {
		return nil
	}

	// mustConditions := make([]map[string]interface{}, 0)

	// for key, value := range filters {
	// 	// Handle 'any' match for slices
	// 	match := map[string]interface{}{"value": value}
	// 	if slice, ok := value.([]interface{}); ok && len(slice) > 0 {
	// 		match = map[string]interface{}{"any": slice}
	// 	}

	// 	condition := map[string]interface{}{
	// 		"key":   key,
	// 		"match": match,
	// 	}
	// 	mustConditions = append(mustConditions, condition)
	// }

	filter := map[string]interface{}{
		"must": filters["must"],
	}

	// 记录构建的过滤条件，便于调试
	logger.SysDebugf("%s", formatFilterDebugMessage(query, filter))

	return filter
}

func formatFilterDebugMessage(query string, filter map[string]interface{}) string {
	filterJSON, _ := json.Marshal(filter)
	if strings.TrimSpace(query) == "" {
		return fmt.Sprintf("【构建的过滤条件】过滤=%s", string(filterJSON))
	}
	return fmt.Sprintf("【构建的过滤条件】问题=%q, 过滤=%s", query, string(filterJSON))
}

// CreateIndex 创建索引（Qdrant自动管理索引）
func (q *QdrantStore) CreateIndex(ctx context.Context, collection string, config IndexConfig) error {
	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant创建索引请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📝 请求方法: CreateIndex")
		logger.SysLogf("│ 📦 集合名称: %s", collection)
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	// Qdrant自动管理索引，这里只是占位实现
	logger.SysLogf("✅ Qdrant自动管理索引，集合: %s", collection)
	return nil
}

// DropIndex 删除索引（Qdrant自动管理索引）
func (q *QdrantStore) DropIndex(ctx context.Context, collection string, indexName string) error {
	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant删除索引请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📝 请求方法: DropIndex")
		logger.SysLogf("│ 📦 集合名称: %s", collection)
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	// Qdrant自动管理索引，这里只是占位实现
	logger.SysLogf("✅ Qdrant自动管理索引，集合: %s", collection)
	return nil
}

// GetIndexInfo 获取索引信息（Qdrant自动管理索引）
func (q *QdrantStore) GetIndexInfo(ctx context.Context, collection string) (*IndexInfo, error) {
	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant获取索引信息请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📝 请求方法: GetIndexInfo")
		logger.SysLogf("│ 📦 集合名称: %s", collection)
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	// 返回默认的HNSW索引信息
	info := &IndexInfo{
		Name:      "default",
		Type:      "HNSW",
		Metric:    q.config.DistanceMetric,
		Status:    "ready",
		Progress:  1.0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	logger.SysLogf("✅ 获取索引信息成功，集合: %s, 类型: %s", collection, info.Type)
	return info, nil
}

// GetStats 获取数据库统计信息
func (q *QdrantStore) GetStats(ctx context.Context) (*DBStats, error) {
	url := fmt.Sprintf("%s/cluster", q.config.Endpoint)

	if q.config.VerboseLogging {
		logger.SysLogf("=====\n🚀 Qdrant获取统计信息请求开始")
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ 📡 请求URL: %s", url)
		logger.SysLogf("│ 📝 请求方法: GET")
		logger.SysLogf("└─────────────────────────────────────────────────────────────")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		logger.SysLogf("❌ 创建请求失败: %v", err)
		return nil, err
	}

	if q.config.APIKey != "" {
		req.Header.Set("api-key", q.config.APIKey)
		if q.config.VerboseLogging {
			logger.SysLogf("🔑 使用 API Key: %s****", q.config.APIKey[:4])
		}
	}

	resp, err := q.client.Do(req)
	if err != nil {
		logger.SysLogf("❌ HTTP 请求失败: %v", err)
		return nil, NewVectorStoreError(ErrCodeConnectionFailed, "failed to get stats", err.Error())
	}
	defer resp.Body.Close()

	if q.config.VerboseLogging {
		logger.SysLogf("┌─────────────────────────────────────────────────────────────")
		logger.SysLogf("│ ✅ 响应状态: %d", resp.StatusCode)
		logger.SysLogf("└─────────────────────────────────────────────────────────────\n")
	}

	if resp.StatusCode != http.StatusOK {
		if q.config.VerboseLogging {
			logger.SysLogf("⚠️  集群信息不可用，返回基本统计信息")
		}
		// 如果集群信息不可用，返回基本统计信息
		collections, err := q.ListCollections(ctx)
		if err != nil {
			logger.SysLogf("❌ 获取集合列表失败: %v", err)
			return nil, err
		}

		stats := &DBStats{
			Collections: len(collections),
			Status:      "running",
			Version:     "unknown",
			Uptime:      0,
		}
		logger.SysLogf("✅ 获取统计信息成功，集合数: %d, 状态: %s", stats.Collections, stats.Status)
		return stats, nil
	}

	var response struct {
		Result struct {
			Status string `json:"status"`
		} `json:"result"`
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysLogf("❌ 读取响应体失败: %v", err)
		return nil, err
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		logger.SysLogf("❌ 响应解析失败: %v", err)
		return nil, err
	}

	// 获取集合列表
	collections, err := q.ListCollections(ctx)
	if err != nil {
		logger.SysLogf("❌ 获取集合列表失败: %v", err)
		return nil, err
	}

	// 计算总向量数
	var totalVectors int64
	for _, collectionName := range collections {
		info, err := q.GetCollectionInfo(ctx, collectionName)
		if err == nil {
			totalVectors += info.VectorCount
		}
	}

	stats := &DBStats{
		Collections:  len(collections),
		TotalVectors: totalVectors,
		Status:       response.Result.Status,
		Version:      "unknown",
		Uptime:       0,
	}
	logger.SysLogf("✅ 获取统计信息成功，集合数: %d, 向量总数: %d, 状态: %s", stats.Collections, stats.TotalVectors, stats.Status)
	return stats, nil
}

// SetHTTPClient sets a custom HTTP client (for testing/benchmarking)
func (q *QdrantStore) SetHTTPClient(client *http.Client) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.client = client
}

// FlushBuffer manually flushes all buffered vectors
func (q *QdrantStore) FlushBuffer() {
	q.mu.RLock()
	buffer := q.buffer
	q.mu.RUnlock()

	if buffer != nil {
		buffer.Flush()
	}
}
