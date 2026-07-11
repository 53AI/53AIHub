# RAG Pipeline 开发规范文档

## 1. 注册流水线方法

### 1.1 流水线注册位置
所有流水线应在 `/home/liuzimu/code/KM/service/rag_job_engine.go` 文件的 `registerDefaultPipelines` 函数中注册。

### 1.2 注册方式
```go
func registerDefaultPipelines() {
    // 注册流水线
    pipelines.RegisterPipeline("流水线类型", func() pipelines.Pipeline {
        return pipelines.New流水线名WithDB(model.DB)
    })
}
```

### 1.3 注册示例
```go
// 注册RechunkAndReindex流水线
pipelines.RegisterPipeline("rechunk_and_reindex", func() pipelines.Pipeline {
    return pipelines.NewRechunkAndReindexPipelineWithDB(model.DB)
})
```

### 1.4 注意事项
- 必须使用带数据库连接的构造函数（`WithDB` 后缀）
- 流水线类型名称应使用下划线分隔的小写字母
- 注册的流水线类型应与流水线结构体的类型字段一致

## 2. 创建发送 Job 任务

### 2.1 创建任务方法
使用 `/home/liuzimu/code/KM/service/rag_job_engine.go` 文件中的 `CreateJob` 函数创建任务：

```go
func CreateJob(ctx context.Context, eid int64, jobType string, startParameters string) (*model.RagJob, error)
```

### 2.2 参数说明
- `ctx`: 上下文
- `eid`: 企业ID
- `jobType`: 流水线类型（与注册时使用的类型一致）
- `startParameters`: 流水线参数的JSON字符串

### 2.3 创建任务示例
```go
// 准备参数
params := RechunkAndReindexParameters{
    Eid:    eid,
    FileID: fileID,
    UserID: userID,
}
paramsJSON, _ := json.Marshal(params)

// 创建任务
job, err := CreateJob(ctx, eid, "rechunk_and_reindex", string(paramsJSON))
if err != nil {
    return err
}
```

### 2.4 参数结构体定义
每个流水线应定义自己的参数结构体，例如：
```go
type RechunkAndReindexParameters struct {
    Eid    int64 `json:"eid"`
    FileID int64 `json:"file_id"`
    UserID int64 `json:"user_id"`
}

type ReindexParameters struct {
    Eid           int64 `json:"eid"`
    FileID        int64 `json:"file_id"`
    UserID        int64 `json:"user_id"`
    RunAIIndexTask bool  `json:"run_ai_index_task"` // 是否运行AI索引任务，默认为false
}

type PipelineParameters struct {
    Eid            int64 `json:"eid"`
    FileID         int64 `json:"file_id"`
    UserID         int64 `json:"user_id"`
    RunAIIndexTask bool  `json:"run_ai_index_task"`
}
```

## 3. 流水线文件规范

### 3.1 文件位置
流水线文件应放在 `/home/liuzimu/code/KM/rag-pipeline/pipelines/` 目录下。

### 3.2 文件命名
文件名应使用下划线分隔的小写字母，例如：`rechunk_and_reindex.go`

### 3.3 流水线结构体定义
```go
type 流水线名Pipeline struct {
    *BasePipeline
}
```

### 3.4 构造函数
必须提供两个构造函数：
1. 不带数据库连接的构造函数（用于注册）
2. 带数据库连接的构造函数（用于实际使用）

```go
// 不带数据库连接的构造函数
func New流水线名Pipeline() Pipeline {
    pipeline := &流水线名Pipeline{
        BasePipeline: NewBasePipeline("流水线类型"),
    }
    
    // 注册流水线
    RegisterPipeline("流水线类型", func() Pipeline {
        return New流水线名Pipeline()
    })
    
    return pipeline
}

// 带数据库连接的构造函数
func New流水线名PipelineWithDB(db *gorm.DB) Pipeline {
    pipeline := &流水线名Pipeline{
        BasePipeline: NewBasePipelineWithDB("流水线类型", db),
    }
    
    return pipeline
}
```

### 3.5 Initialize 方法
在 `Initialize` 方法中添加流水线所需的步骤：

```go
func (p *流水线名Pipeline) Initialize() error {
    // 添加步骤
    step := steps.New步骤名Step(p.DB)
    if err := p.AddStep("步骤名", step); err != nil {
        return err
    }
    
    // 添加更多步骤...
    
    return nil
}
```

### 3.6 PrepareStepParameters 方法
根据步骤顺序准备对应的参数：

```go
func (p *流水线名Pipeline) PrepareStepParameters(order int) interface{} {
    // 从上下文中获取参数
    var eid, fileID, userID int64
    // 获取参数逻辑...
    
    // 根据步骤顺序返回对应的参数
    switch order {
    case 1:
        return steps.步骤名Parameters{
            Eid:    eid,
            FileID: fileID,
            UserID: userID,
        }
    // 更多步骤...
    default:
        return nil
    }
}
```

### 3.7 Execute 方法
实现流水线的执行逻辑：

```go
func (p *流水线名Pipeline) Execute(job *model.RagJob) error {
    // 解析参数
    var params 流水线名Parameters
    if job.StartParameters != "" {
        if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
            return fmt.Errorf("failed to unmarshal parameters: %v", err)
        }
    }
    
    // 将参数添加到上下文中
    p.Context["eid"] = params.Eid
    p.Context["file_id"] = params.FileID
    p.Context["user_id"] = params.UserID
    
    // 如果尚未初始化，则初始化流水线
    if len(p.Steps) == 0 {
        if err := p.Initialize(); err != nil {
            job.Status = model.RagJobStatusFailed
            job.FailureReason = err.Error()
            return err
        }
    }
    
    // 使用自身作为执行器调用基础执行方法
    return p.BasePipeline.ExecuteWithExecutor(job, p)
}
```

## 4. 步骤文件规范

### 4.1 文件位置
步骤文件应放在 `/home/liuzimu/code/KM/rag-pipeline/steps/` 目录下。

### 4.2 文件命名
文件名应使用下划线分隔的小写字母，例如：`cleanup.go`

### 4.3 步骤结构体定义
```go
type 步骤名Step struct {
    BaseStep
    DB *gorm.DB
}
```

### 4.4 参数结构体定义
```go
type 步骤名Parameters struct {
    Eid    int64 `json:"eid"`
    FileID int64 `json:"file_id"`
    UserID int64 `json:"user_id"`
    // 其他参数...
}
```

### 4.5 结果结构体定义
```go
type 步骤名Result struct {
    // 结果字段...
    Success bool `json:"success"`
}
```

### 4.6 构造函数
```go
func New步骤名Step(db *gorm.DB) *步骤名Step {
    return &步骤名Step{
        DB: db,
    }
}
```

### 4.7 Execute 方法
实现步骤的执行逻辑：

```go
func (s *步骤名Step) Execute(parameters any) error {
    // 开始处理
    s.Step.StartProcessing(parameters)
    
    // 类型断言获取参数
    params, ok := parameters.(步骤名Parameters)
    if !ok {
        err := fmt.Errorf("invalid parameters type, expected 步骤名Parameters")
        s.Step.CompleteWithError(err.Error())
        return err
    }
    
    // 执行步骤逻辑...
    
    // 创建结果
    result := 步骤名Result{
        // 设置结果字段...
        Success: true,
    }
    
    // 完成步骤并返回结果
    s.Step.CompleteSuccessfully(result)
    return nil
}
```

### 4.8 错误处理
在步骤执行过程中，如果发生错误，应该：
1. 记录错误信息
2. 调用 `s.Step.CompleteWithError(errMsg)` 标记步骤失败
3. 返回错误

```go
if err != nil {
    errMsg := fmt.Sprintf("操作失败: %v", err)
    s.Step.CompleteWithError(errMsg)
    return fmt.Errorf(errMsg)
}
```

## 5. 其他规范

### 5.1 日志记录
在关键操作处添加适当的日志记录，便于调试和监控。

### 5.2 事务处理
对于涉及多个数据库操作的场景，应使用事务确保数据一致性。

### 5.3 上下文传递
使用流水线的 `Context` 字段在步骤之间传递数据。

### 5.4 并行执行
如果需要并行执行某些步骤，可以使用 `ParallelGroups` 字段定义并行组。

## 6. 示例代码

### 6.1 完整流水线示例
参考 `rechunk_and_reindex.go` 文件，这是一个完整的流水线实现示例。

### 6.2 完整步骤示例
参考 `cleanup.go` 文件，这是一个完整的步骤实现示例。

这份规范文档基于 rag-pipeline 的现有代码实现，涵盖了流水线开发的主要方面。遵循这些规范可以确保代码的一致性和可维护性。
