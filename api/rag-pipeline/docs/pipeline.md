# RAG 流水线机制文档

## 概述

RAG流水线是一个灵活的、可扩展的任务处理框架，支持顺序执行和并行执行步骤。本文档详细介绍了流水线的架构、使用方法和高级功能。

## 架构概述

### 核心组件

1. **Pipeline接口** - 定义了流水线的基本行为
2. **BasePipeline** - 提供了流水线的默认实现
3. **Step接口** - 定义了步骤的基本行为
4. **StepResult** - 存储步骤执行结果
5. **PipelineRegistry** - 流水线注册表，管理所有可用的流水线

### 执行流程

1. 流水线初始化
2. 步骤排序和分组
3. 顺序执行和并行执行步骤
4. 结果收集和状态更新

## 基本使用

### 创建流水线

```go
type MyPipeline struct {
    *pipelines.BasePipeline
}

func NewMyPipeline() pipelines.Pipeline {
    p := &MyPipeline{
        BasePipeline: &pipelines.BasePipeline{},
    }
    p.Initialize("my_pipeline", "My custom pipeline")
    
    // 注册流水线
    pipelines.RegisterPipeline("my_pipeline", p)
    return p
}
```

### 定义步骤

```go
type MyStep struct {
    order int64
}

func NewMyStep(order int64) pipelines.Step {
    return &MyStep{order: order}
}

func (s *MyStep) GetOrder() int64 {
    return s.order
}

func (s *MyStep) GetName() string {
    return fmt.Sprintf("MyStep_%d", s.order)
}

func (s *MyStep) Execute(ctx context.Context, job *model.RagJob, params map[string]interface{}) (map[string]interface{}, error) {
    // 步骤执行逻辑
    result := map[string]interface{}{
        "message": fmt.Sprintf("Processed by step %d", s.order),
        "timestamp": time.Now().Unix(),
    }
    return result, nil
}
```

### 初始化流水线

```go
func (p *MyPipeline) Initialize() error {
    // 添加步骤
    p.AddStep(NewMyStep(1))
    p.AddStep(NewMyStep(2))
    
    return nil
}
```

### 执行流水线

```go
// 获取流水线
pipeline, err := pipelines.GetPipeline("my_pipeline")
if err != nil {
    log.Fatalf("Failed to get pipeline: %v", err)
}

// 创建任务
job := &model.RagJob{
    JobID: 123,
    Eid:   456,
}

// 执行流水线
err = pipeline.Execute(job)
if err != nil {
    log.Fatalf("Failed to execute pipeline: %v", err)
}
```

## 高级功能

### 并行执行

流水线支持并行执行一组步骤，只需为这些步骤指定相同的并行组ID：

```go
func (p *MyPipeline) Initialize() error {
    // 顺序执行的步骤
    p.AddStep(NewMyStep(1))
    
    // 并行执行的步骤
    p.AddStepToParallelGroup(NewMyStep(2), "parallel_group_1")
    p.AddStepToParallelGroup(NewMyStep(3), "parallel_group_1")
    
    // 顺序执行的步骤
    p.AddStep(NewMyStep(4))
    
    return nil
}
```

### 步骤参数准备

可以通过重写`PrepareStepParameters`方法为每个步骤准备特定的参数：

```go
func (p *MyPipeline) PrepareStepParameters(ctx context.Context, job *model.RagJob, step pipelines.Step) (map[string]interface{}, error) {
    // 基础参数
    params := map[string]interface{}{
        "order":   step.GetOrder(),
        "context": ctx,
    }
    
    // 根据步骤类型添加特定参数
    switch step.GetOrder() {
    case 2:
        // 获取前一个步骤的结果
        prevResult, err := p.GetPreviousStepResult(job, step)
        if err == nil {
            params["prev_result"] = prevResult
        }
    case 3:
        // 获取特定步骤的结果
        step1Result, err := p.GetStepResult(1)
        if err == nil {
            params["step1_result"] = step1Result
        }
    }
    
    return params, nil
}
```

### 获取任意步骤的结果和参数

流水线支持通过order值获取任意已完成步骤的结果和参数：

```go
// 获取BasePipeline实例
if helloPipelineImpl, ok := helloPipeline.(*pipelines.HelloPipeline); ok {
    basePipeline := helloPipelineImpl.BasePipeline
    
    // 获取指定步骤的结果
    step1Result, err := basePipeline.GetStepResult(1)
    if err != nil {
        log.Printf("Error getting step 1 result: %v", err)
    } else {
        fmt.Printf("Step 1 result: %v\n", step1Result)
    }
    
    // 获取指定步骤的参数
    step1Params, err := basePipeline.GetStepParameters(1)
    if err != nil {
        log.Printf("Error getting step 1 parameters: %v", err)
    } else {
        fmt.Printf("Step 1 parameters: %v\n", step1Params)
    }
}
```

## 示例

### Hello流水线示例

```go
type HelloPipeline struct {
    *pipelines.BasePipeline
}

func NewHelloPipeline() pipelines.Pipeline {
    p := &HelloPipeline{
        BasePipeline: &pipelines.BasePipeline{},
    }
    p.Initialize("hello", "Hello Pipeline")
    
    // 注册流水线
    pipelines.RegisterPipeline("hello", p)
    return p
}

func (p *HelloPipeline) Initialize() error {
    // 添加步骤
    p.AddStep(steps.NewHelloWorldStep(1))
    
    // 添加并行步骤
    p.AddStepToParallelGroup(steps.NewHelloWorldStep(2), "parallel_group_1")
    p.AddStepToParallelGroup(steps.NewHelloWorldStep(3), "parallel_group_1")
    
    // 添加最终步骤
    p.AddStep(steps.NewHelloWorldStep(4))
    
    return nil
}
```

### 执行示例

```go
func main() {
    // 注册所有流水线
    _ = pipelines.NewHelloPipeline()
    
    // 获取hello流水线
    helloPipeline, err := pipelines.GetPipeline("hello")
    if err != nil {
        log.Fatalf("Failed to get hello pipeline: %v", err)
    }
    
    // 创建一个测试任务
    job := &model.RagJob{
        JobID: 123,
        Eid:   456,
    }
    
    // 执行流水线
    if err := helloPipeline.Execute(job); err != nil {
        log.Fatalf("Failed to execute pipeline: %v", err)
    }
    
    fmt.Println("Pipeline execution completed with status:", job.Status)
}
```

## API参考

### Pipeline接口

```go
type Pipeline interface {
    // 获取流水线名称
    GetName() string
    
    // 获取流水线描述
    GetDescription() string
    
    // 执行流水线
    Execute(job *model.RagJob) error
    
    // 初始化流水线
    Initialize(name, description string) error
}
```

### Step接口

```go
type Step interface {
    // 获取步骤顺序
    GetOrder() int64
    
    // 获取步骤名称
    GetName() string
    
    // 执行步骤
    Execute(ctx context.Context, job *model.RagJob, params map[string]interface{}) (map[string]interface{}, error)
}
```

### BasePipeline方法

```go
// 添加步骤
AddStep(step Step)

// 添加步骤到并行组
AddStepToParallelGroup(step Step, parallelGroupID string)

// 获取步骤结果
GetStepResult(order int64) (map[string]interface{}, error)

// 获取步骤参数
GetStepParameters(order int64) (map[string]interface{}, error)

// 获取前一个步骤的结果
GetPreviousStepResult(job *model.RagJob, step Step) (map[string]interface{}, error)

// 准备步骤参数
PrepareStepParameters(ctx context.Context, job *model.RagJob, step Step) (map[string]interface{}, error)
```

## 最佳实践

1. **步骤设计** - 保持步骤的单一职责，避免在单个步骤中执行过多逻辑
2. **错误处理** - 在步骤中正确处理错误，确保流水线能够正确响应失败情况
3. **参数传递** - 使用步骤参数传递必要的数据，避免在步骤间共享状态
4. **并行执行** - 合理使用并行执行提高性能，但要注意步骤间的依赖关系
5. **结果访问** - 使用`GetStepResult`和`GetStepParameters`方法访问其他步骤的结果和参数

## 扩展指南

### 自定义步骤类型

```go
type CustomStep struct {
    order   int64
    config  CustomConfig
}

func (s *CustomStep) Execute(ctx context.Context, job *model.RagJob, params map[string]interface{}) (map[string]interface{}, error) {
    // 自定义执行逻辑
    return result, nil
}
```

### 自定义流水线类型

```go
type CustomPipeline struct {
    *pipelines.BasePipeline
    customConfig CustomConfig
}

func (p *CustomPipeline) Initialize() error {
    // 自定义初始化逻辑
    return nil
}

func (p *CustomPipeline) PrepareStepParameters(ctx context.Context, job *model.RagJob, step pipelines.Step) (map[string]interface{}, error) {
    // 自定义参数准备逻辑
    return params, nil
}
```

## 故障排除

### 常见问题

1. **步骤执行失败** - 检查步骤的Execute方法是否正确处理了错误情况
2. **并行执行问题** - 确保并行步骤之间没有共享状态或依赖关系
3. **参数传递问题** - 验证PrepareStepParameters方法是否正确准备了步骤参数
4. **结果访问问题** - 确保在访问步骤结果时步骤已经执行完成

### 调试技巧

1. 启用详细日志记录
2. 使用步骤结果和参数访问功能检查中间状态
3. 在步骤中添加调试输出
4. 使用单元测试验证步骤和流水线的行为

## 总结

RAG流水线提供了一个强大而灵活的框架，用于构建复杂的数据处理流程。通过合理使用顺序执行、并行执行和结果访问功能，可以构建高效、可维护的数据处理管道。