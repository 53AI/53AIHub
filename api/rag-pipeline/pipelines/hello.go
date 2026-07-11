package pipelines

import (
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// HelloPipeline 示例流水线实现
type HelloPipeline struct {
	*BasePipeline
}

// NewHelloPipeline 创建新的 Hello 流水线
func NewHelloPipeline() Pipeline {
	pipeline := &HelloPipeline{
		BasePipeline: NewBasePipeline("hello"),
	}

	// 注册流水线
	RegisterPipeline("hello", func() Pipeline {
		return NewHelloPipeline()
	})

	return pipeline
}

// NewHelloPipelineWithDB 创建带有数据库连接的 Hello 流水线
func NewHelloPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &HelloPipeline{
		BasePipeline: NewBasePipelineWithDB("hello", db),
	}

	return pipeline
}

// Initialize 初始化 Hello 流水线
func (p *HelloPipeline) Initialize() error {
	// 添加步骤到流水线

	// 步骤1: Hello World
	helloStep := &steps.HelloWorldStep{}
	if err := p.AddStep("hello_step_1", helloStep); err != nil {
		return err
	}

	// 步骤2: 另一个 Hello World，与步骤3并行
	helloStep2 := &steps.HelloWorldStep{}
	if err := p.AddStep("hello_step_2", helloStep2); err != nil {
		return err
	}

	// 步骤3: 另一个 Hello World，与步骤2并行
	helloStep3 := &steps.HelloWorldStep{}
	if err := p.AddStep("hello_step_3", helloStep3); err != nil {
		return err
	}

	// 步骤4: 最后一个 Hello World
	helloStep4 := &steps.HelloWorldStep{}
	if err := p.AddStep("hello_step_4", helloStep4); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *HelloPipeline) PrepareStepParameters(order int) interface{} {
	// 根据步骤顺序准备不同的参数
	switch order {
	case 1:
		return steps.HelloWorldParameters{
			Message: "Hello from Hello Pipeline Step 1",
		}
	case 2:
		// 首先尝试获取前一个顺序步骤的结果
		prevResult, err := p.GetPreviousSequentialStepResult(order)
		if err == nil {
			// 将前一步骤的结果转换为字符串
			resultStr := fmt.Sprintf("%v", prevResult)
			return steps.HelloWorldParameters{
				Message: fmt.Sprintf("Hello from Hello Pipeline Step 2 (Parallel) - Previous result: %s", resultStr),
			}
		}

		// 如果无法获取前一个顺序步骤的结果，尝试从上下文中获取
		if p.Context != nil {
			for key, value := range p.Context {
				if key == "prev_step_result_1" {
					resultStr := fmt.Sprintf("%v", value)
					return steps.HelloWorldParameters{
						Message: fmt.Sprintf("Hello from Hello Pipeline Step 2 (Parallel) - Previous result from context: %s", resultStr),
					}
				}
			}
		}

		// 如果都没有，返回默认消息
		return steps.HelloWorldParameters{
			Message: "Hello from Hello Pipeline Step 2 (Parallel) - No previous result",
		}
	case 3:
		// 首先尝试获取前一个顺序步骤的结果
		prevResult, err := p.GetPreviousSequentialStepResult(order)
		if err == nil {
			// 将前一步骤的结果转换为字符串
			resultStr := fmt.Sprintf("%v", prevResult)
			return steps.HelloWorldParameters{
				Message: fmt.Sprintf("Hello from Hello Pipeline Step 3 (Parallel) - Previous result: %s", resultStr),
			}
		}

		// 如果无法获取前一个顺序步骤的结果，尝试从上下文中获取
		if p.Context != nil {
			for key, value := range p.Context {
				if key == "prev_step_result_1" {
					resultStr := fmt.Sprintf("%v", value)
					return steps.HelloWorldParameters{
						Message: fmt.Sprintf("Hello from Hello Pipeline Step 3 (Parallel) - Previous result from context: %s", resultStr),
					}
				}
			}
		}

		// 如果都没有，返回默认消息
		return steps.HelloWorldParameters{
			Message: "Hello from Hello Pipeline Step 3 (Parallel) - No previous result",
		}
	case 4:
		// 获取前一个顺序步骤的结果（步骤2或3，因为它们是并行的）
		prevResult, err := p.GetPreviousStepResult(order)
		if err != nil {
			return steps.HelloWorldParameters{
				Message: "Hello from Hello Pipeline Step 4 (Final) - No previous result",
			}
		}

		// 将前一步骤的结果转换为字符串
		resultStr := fmt.Sprintf("%v", prevResult)
		return steps.HelloWorldParameters{
			Message: fmt.Sprintf("Hello from Hello Pipeline Step 4 (Final) - Previous result: %s", resultStr),
		}
	default:
		return steps.HelloWorldParameters{
			Message: "Hello from Hello Pipeline Default Step",
		}
	}
}

// Execute 执行 Hello 流水线
func (p *HelloPipeline) Execute(job *model.RagJob) error {
	// 如果尚未初始化，则初始化流水线
	if len(p.Steps) == 0 {
		if err := p.Initialize(); err != nil {
			if p.DB != nil {
				if updateErr := job.UpdateJobStatusToFailed(p.DB, err.Error()); updateErr != nil {
					logger.SysErrorf("更新job失败状态出错: %v", updateErr)
				}
			}
			return err
		}
	}

	// 使用自身作为执行器调用基础执行方法
	return p.BasePipeline.ExecuteWithExecutor(job, p)
}
