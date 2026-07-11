# 文档转换服务 SDK

## 概述

文档转换服务 SDK 提供了与文档转换服务的对接能力，支持同步和异步两种转换模式。

## 配置

在 `.env` 文件中配置以下环境变量：

```bash
# 文档转换服务配置
DOC_CONVERT_BASE_URL=http://192.168.1.218:5022
DOC_CONVERT_API_KEY=123456
DOC_CONVERT_TIMEOUT=1800
DOC_CONVERT_MAX_FILE_SIZE=100MB
DOC_CONVERT_RETRY_TIMES=3
DOC_CONVERT_POLL_INTERVAL=5
```

## 使用方式

### 1. 同步转换

```go
package main

import (
    "context"
    "fmt"
    "github.com/53AI/53AIHub/service/docconv"
)

func main() {
    service := docconv.NewService()
    
    result, err := service.ConvertSync(context.Background(), 
        "https://example.com/document.pdf", 
        "markitdown")
    if err != nil {
        fmt.Printf("转换失败: %v\n", err)
        return
    }
    
    fmt.Printf("转换结果: %s\n", result)
}
```

### 2. 异步转换（队列模式）

```go
package main

import (
    "context"
    "fmt"
    "github.com/53AI/53AIHub/service/docconv"
)

func main() {
    service := docconv.NewService()
    
    // 入队任务
    taskID, err := service.ConvertAsync(context.Background(), 
        "https://example.com/document.pdf", 
        "markitdown")
    if err != nil {
        fmt.Printf("入队失败: %v\n", err)
        return
    }
    
    fmt.Printf("任务已入队: %s\n", taskID)
    
    // 启动消费者处理队列
    ctx := context.Background()
    service.StartWorker(ctx, 1) // 启动1个消费者
}
```

### 3. 队列管理

```go
// 获取队列大小
size, err := service.GetQueueSize(context.Background())

// 取消任务
err = service.CancelTask(context.Background(), taskID)

// 健康检查
err = service.Health(context.Background())
```

## 功能特性

### 核心功能
- **同步转换**: 直接提交任务并等待结果
- **异步转换**: 任务入队，由消费者异步处理
- **队列管理**: 基于 Redis ZSet 实现的可靠队列
- **健康检查**: 检查服务可用性

### 技术特性
- **指数退避轮询**: 初始5秒，最大30秒间隔
- **文件大小检查**: 支持预检查文件大小限制
- **超时控制**: 支持 context 取消和超时
- **错误处理**: 统一的错误类型和重试策略
- **日志记录**: 完整的操作日志

### 队列特性
- **Redis ZSet**: 基于时间戳排序的可靠队列
- **并发消费**: 支持多消费者并发处理
- **任务取消**: 支持取消排队中的任务
- **队列监控**: 实时查看队列大小

## API 接口

### Service 接口

```go
type Service interface {
    // 同步转换
    ConvertSync(ctx context.Context, sourceURL, parserType string) (string, error)
    
    // 异步转换（入队）
    ConvertAsync(ctx context.Context, sourceURL, parserType string) (string, error)
    
    // 处理队列任务
    ProcessQueue(ctx context.Context) error
    
    // 取消任务
    CancelTask(ctx context.Context, taskID string) error
    
    // 获取队列大小
    GetQueueSize(ctx context.Context) (int64, error)
    
    // 健康检查
    Health(ctx context.Context) error
    
    // 启动消费者
    StartWorker(ctx context.Context, concurrency int)
}
```

### 错误处理

所有错误都实现了 `ConvertError` 类型：

```go
type ConvertError struct {
    Op         string `json:"op"`          // 操作类型
    HTTPStatus int    `json:"http_status"` // HTTP状态码
    Code       string `json:"code"`        // 错误代码
    Message    string `json:"message"`     // 错误消息
    RawBody    string `json:"raw_body"`    // 原始响应体（截断）
    Retryable  bool   `json:"retryable"`   // 是否可重试
    RequestID  string `json:"request_id"`  // 请求ID
}
```

## 依赖要求

- Redis: 用于队列存储（可选，不启用则无法使用异步模式）
- Go 标准库: net/http, encoding/json, context 等
- 项目依赖: common/logger, common/redis, common/utils/env

## 注意事项

1. **Redis 依赖**: 异步模式需要 Redis 支持，同步模式可独立使用
2. **文件大小**: 会预检查文件大小，超限直接拒绝
3. **超时控制**: 默认300秒总超时，包含提交、轮询、下载全过程
4. **编码假设**: 下载结果假设为 UTF-8 编码的 Markdown
5. **取消语义**: 仅支持本地取消，无法中止远端任务