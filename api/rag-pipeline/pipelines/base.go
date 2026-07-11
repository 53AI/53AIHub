package pipelines

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// Pipeline 接口定义
type Pipeline interface {
	// 执行整个流水线
	Execute(job *model.RagJob) error

	// 添加步骤到流水线
	AddStep(stepName string, step steps.StepProcessor) error

	// 获取流水线类型
	GetType() string

	// 初始化流水线
	Initialize() error
}

// BasePipeline 基础流水线实现
type BasePipeline struct {
	Type           string                      // 流水线类型
	Steps          map[int]steps.StepProcessor // 按顺序存储步骤
	ParallelGroups map[string][]int            // 并行组定义
	Context        map[string]interface{}      // 步骤间共享的上下文
	StepDBs        map[int]*model.RagJobStep   // 步骤数据库记录
	DB             *gorm.DB                    // 数据库连接
	mu             sync.RWMutex                // 读写锁
}

// NewBasePipeline 创建新的基础流水线
func NewBasePipeline(pipelineType string) *BasePipeline {
	return &BasePipeline{
		Type:           pipelineType,
		Steps:          make(map[int]steps.StepProcessor),
		ParallelGroups: make(map[string][]int),
		Context:        make(map[string]interface{}),
		StepDBs:        make(map[int]*model.RagJobStep),
	}
}

// NewBasePipelineWithDB 创建带有数据库连接的基础流水线
func NewBasePipelineWithDB(pipelineType string, db *gorm.DB) *BasePipeline {
	return &BasePipeline{
		Type:           pipelineType,
		Steps:          make(map[int]steps.StepProcessor),
		ParallelGroups: make(map[string][]int),
		Context:        make(map[string]interface{}),
		StepDBs:        make(map[int]*model.RagJobStep),
		DB:             db,
	}
}

// getStackTrace 获取调用栈信息
func getStackTrace(skip int) string {
	buf := make([]byte, 1024)
	for {
		n := runtime.Stack(buf, false)
		if n < len(buf) {
			return string(buf[:n])
		}
		buf = make([]byte, 2*len(buf))
	}
}

// formatErrorWithStack 格式化错误信息，包含调用栈
func formatErrorWithStack(err error) string {
	if err == nil {
		return ""
	}

	// 获取调用栈
	stack := getStackTrace(3) // 跳过3层调用栈

	// 提取有用的调用栈信息
	lines := strings.Split(stack, "\n")
	var usefulLines []string
	for i, line := range lines {
		// 跳过前几行（通常是runtime和当前函数）
		if i < 4 {
			continue
		}
		// 只保留包含项目路径的行
		if strings.Contains(line, "53AI/") {
			usefulLines = append(usefulLines, line)
		}
		// 限制调用栈深度
		if len(usefulLines) >= 10 {
			break
		}
	}

	// 组合错误信息和调用栈
	result := err.Error()
	if len(usefulLines) > 0 {
		result += "\nCall Stack:\n" + strings.Join(usefulLines, "\n")
	}

	return result
}

// GetType 获取流水线类型
func (p *BasePipeline) GetType() string {
	return p.Type
}

// AddStep 添加步骤到流水线
func (p *BasePipeline) AddStep(stepName string, step steps.StepProcessor) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// 获取下一个可用的步骤顺序
	order := len(p.Steps) + 1

	// 检查步骤顺序是否已存在
	if _, exists := p.Steps[order]; exists {
		return fmt.Errorf("step with order %d already exists", order)
	}

	// 添加步骤
	p.Steps[order] = step

	return nil
}

// Initialize 初始化流水线
func (p *BasePipeline) Initialize() error {
	// 基础实现，子类可以重写
	return nil
}

// Execute 执行流水线
func (p *BasePipeline) Execute(job *model.RagJob) error {
	// 更新任务状态为处理中
	job.Status = model.RagJobStatusProcessing
	if p.DB != nil {
		if err := p.DB.Model(job).Update("status", model.RagJobStatusProcessing).Error; err != nil {
			return fmt.Errorf("failed to update job status to processing: %v", err)
		}
	}

	// 加载步骤数据
	if err := p.loadSteps(job); err != nil {
		if p.DB != nil {
			if updateErr := job.UpdateJobStatusToFailed(p.DB, fmt.Sprintf("Failed to load steps: %v", err)); updateErr != nil {
				logger.SysErrorf("更新job失败状态出错: %v", updateErr)
			}
		}
		return err
	}

	// 执行步骤
	if err := p.executeSteps(job); err != nil {
		if p.DB != nil {
			if updateErr := job.UpdateJobStatusToFailed(p.DB, fmt.Sprintf("Failed to execute steps: %v", err)); updateErr != nil {
				logger.SysErrorf("更新job失败状态出错: %v", updateErr)
			}
		}
		return err
	}

	// 更新任务状态为成功
	job.Status = model.RagJobStatusSuccess
	if p.DB != nil {
		if err := p.DB.Model(job).Update("status", model.RagJobStatusSuccess).Error; err != nil {
			return fmt.Errorf("failed to update job status to success: %v", err)
		}
	}
	return nil
}

// ExecuteWithExecutor 使用指定的执行器执行流水线
func (p *BasePipeline) ExecuteWithExecutor(job *model.RagJob, executor interface{}) error {
	// 更新任务状态为处理中
	job.Status = model.RagJobStatusProcessing
	if p.DB != nil {
		if err := p.DB.Model(job).Update("status", model.RagJobStatusProcessing).Error; err != nil {
			return fmt.Errorf("failed to update job status to processing: %v", err)
		}
	}

	// 加载步骤数据
	if err := p.loadSteps(job); err != nil {
		if p.DB != nil {
			if updateErr := job.UpdateJobStatusToFailed(p.DB, fmt.Sprintf("Failed to load steps: %v", err)); updateErr != nil {
				logger.SysErrorf("更新job失败状态出错: %v", updateErr)
			}
		}
		return err
	}

	// 执行步骤
	if err := p.executeStepsWithExecutor(job, executor); err != nil {
		if p.DB != nil {
			if updateErr := job.UpdateJobStatusToFailed(p.DB, fmt.Sprintf("Failed to execute steps: %v", err)); updateErr != nil {
				logger.SysErrorf("更新job失败状态出错: %v", updateErr)
			}
		}
		return err
	}

	// 更新任务状态为成功
	job.Status = model.RagJobStatusSuccess
	if p.DB != nil {
		if err := p.DB.Model(job).Update("status", model.RagJobStatusSuccess).Error; err != nil {
			return fmt.Errorf("failed to update job status to success: %v", err)
		}
	}
	return nil
}

// loadSteps 从数据库加载步骤数据
func (p *BasePipeline) loadSteps(job *model.RagJob) error {
	// 初始化步骤数据
	p.StepDBs = make(map[int]*model.RagJobStep)

	// 如果有数据库连接，尝试从数据库加载现有步骤
	if p.DB != nil {
		// 查询现有步骤
		var existingSteps []model.RagJobStep
		if err := p.DB.Where("job_id = ?", job.JobID).Find(&existingSteps).Error; err != nil {
			return fmt.Errorf("failed to load existing steps: %v", err)
		}

		// 将现有步骤添加到映射中
		for _, step := range existingSteps {
			p.StepDBs[step.StepOrder] = &step
		}
	}

	// 为流水线中定义但数据库中不存在的步骤创建新记录
	for order := range p.Steps {
		if _, exists := p.StepDBs[order]; !exists {
			step := &model.RagJobStep{
				JobID:     job.JobID,
				Eid:       job.Eid,
				StepOrder: order,
				Status:    model.RagJobStepStatusPending,
			}

			// 如果有数据库连接，保存到数据库
			if p.DB != nil {
				if err := p.DB.Create(step).Error; err != nil {
					return fmt.Errorf("failed to create step %d: %v", order, err)
				}
			}

			p.StepDBs[order] = step
		}
	}

	return nil
}

// executeStepsWithExecutor 使用指定的执行器执行所有步骤
func (p *BasePipeline) executeStepsWithExecutor(job *model.RagJob, executor interface{}) error {
	// 获取所有步骤顺序并排序
	orders := make([]int, 0, len(p.Steps))
	for order := range p.Steps {
		orders = append(orders, order)
	}

	// 对步骤顺序进行排序
	for i := 0; i < len(orders); i++ {
		for j := i + 1; j < len(orders); j++ {
			if orders[i] > orders[j] {
				orders[i], orders[j] = orders[j], orders[i]
			}
		}
	}

	// 按顺序执行步骤
	for _, order := range orders {
		// 检查是否属于某个并行组
		groupName := ""
		for group, groupOrders := range p.ParallelGroups {
			for _, groupOrder := range groupOrders {
				if groupOrder == order {
					groupName = group
					break
				}
			}
			if groupName != "" {
				break
			}
		}

		if groupName != "" {
			// 并行执行组内的所有步骤
			if err := p.executeParallelGroupWithExecutor(job, groupName, executor); err != nil {
				return err
			}

			// 跳过组内其他步骤，因为已经并行执行过了
			for _, groupOrder := range p.ParallelGroups[groupName] {
				for i, o := range orders {
					if o == groupOrder {
						orders = append(orders[:i], orders[i+1:]...)
						break
					}
				}
			}
		} else {
			// 顺序执行单个步骤
			if err := p.executeStepWithExecutor(job, order, executor); err != nil {
				return err
			}
		}
	}

	return nil
}

// executeStepWithExecutor 使用指定的执行器执行单个步骤
func (p *BasePipeline) executeStepWithExecutor(job *model.RagJob, order int, executor interface{}) error {
	step, exists := p.Steps[order]
	if !exists {
		return fmt.Errorf("step with order %d not found", order)
	}

	stepDB, exists := p.StepDBs[order]
	if !exists {
		return fmt.Errorf("step DB record with order %d not found", order)
	}

	// 如果步骤实现了 BaseStep 接口，设置 StepDB
	if baseStep, ok := step.(interface{ SetStep(*model.RagJobStep) }); ok {
		baseStep.SetStep(stepDB)
	}

	// 如果步骤实现了 BaseStep 接口，设置 Job
	if baseStep, ok := step.(interface{ SetJob(*model.RagJob) }); ok {
		baseStep.SetJob(job)
	}

	// 使用执行器准备步骤参数
	var parameters interface{}
	if exec, ok := executor.(interface{ PrepareStepParameters(int) interface{} }); ok {
		parameters = exec.PrepareStepParameters(order)
	} else {
		parameters = p.PrepareStepParameters(order)
	}

	// 获取RAG Job日志记录器
	ragLogger, err := logger.GetRAGJobLogger(p.Type)
	if err != nil {
		ragLogger = nil // 继续处理，不使用日志记录器
	}

	// 获取步骤名称
	stepName := fmt.Sprintf("%T", step)
	if idx := strings.LastIndex(stepName, "."); idx != -1 {
		stepName = stepName[idx+1:]
	}

	// 记录步骤开始
	if ragLogger != nil {
		paramsJSON, _ := json.Marshal(parameters)
		ragLogger.StepStart(job.JobID, order, stepName, string(paramsJSON))
	}

	stepStartTime := time.Now()

	// 更新步骤状态为处理中
	stepDB.Status = model.RagJobStepStatusProcessing
	stepDB.StartTime = stepStartTime.UnixMilli()

	// 执行步骤
	if err := step.Execute(parameters); err != nil {
		// 获取包含调用栈的详细错误信息
		errorWithStack := formatErrorWithStack(err)

		stepDB.CompleteWithError(err.Error())
		stepDB.EndTime = time.Now().UnixMilli()

		// 记录步骤错误
		if ragLogger != nil {
			ragLogger.LogError(job.JobID, err.Error(), errorWithStack)
			ragLogger.StepEnd(job.JobID, order, stepName, "failed", time.Since(stepStartTime), "")
		}

		// 如果有数据库连接，保存状态到数据库
		if p.DB != nil {
			if saveErr := p.DB.Save(stepDB).Error; saveErr != nil {
				return fmt.Errorf("failed to save step %d error status: %v", order, saveErr)
			}
		}

		// 返回包含调用栈的错误信息
		return fmt.Errorf("step %d execution failed: %s", order, errorWithStack)
	}

	// 更新当前步骤顺序
	job.CurrentStepOrder = order

	stepDB.EndTime = time.Now().UnixMilli()

	// 记录步骤成功完成
	if ragLogger != nil {
		resultsJSON, _ := json.Marshal(stepDB.Results)
		ragLogger.StepEnd(job.JobID, order, stepName, "success", time.Since(stepStartTime), string(resultsJSON))
	}

	// 如果有数据库连接，保存状态到数据库
	if p.DB != nil {
		// 保存步骤状态
		if saveErr := p.DB.Save(stepDB).Error; saveErr != nil {
			return fmt.Errorf("failed to save step %d status: %v", order, saveErr)
		}

		// 保存任务当前步骤顺序
		if saveErr := p.DB.Model(job).Update("current_step_order", order).Error; saveErr != nil {
			return fmt.Errorf("failed to save job current step order: %v", saveErr)
		}
	}

	return nil
}

// executeParallelGroupWithExecutor 使用指定的执行器并行执行组内的所有步骤
func (p *BasePipeline) executeParallelGroupWithExecutor(job *model.RagJob, groupName string, executor interface{}) error {
	groupOrders, exists := p.ParallelGroups[groupName]
	if !exists {
		return fmt.Errorf("parallel group %s not found", groupName)
	}

	// 对于并行组，我们需要先获取前一个顺序步骤的结果，以便所有并行步骤都能使用
	var prevResult interface{}
	var prevResultOrder int

	// 找到并行组中最小的步骤顺序
	minOrder := groupOrders[0]
	for _, order := range groupOrders {
		if order < minOrder {
			minOrder = order
		}
	}

	// 获取前一个顺序步骤的结果
	prevResult, err := p.GetPreviousSequentialStepResult(minOrder)
	if err == nil {
		// 找到前一个顺序步骤的顺序
		for order := range p.Steps {
			if order < minOrder {
				// 检查这个步骤是否属于并行组
				isParallelGroup := false
				for _, groupOrders := range p.ParallelGroups {
					for _, groupOrder := range groupOrders {
						if groupOrder == order {
							isParallelGroup = true
							break
						}
					}
					if isParallelGroup {
						break
					}
				}

				// 如果不是并行步骤，则记录为前一个顺序步骤
				if !isParallelGroup {
					prevResultOrder = order
				}
			}
		}

		// 将前一个顺序步骤的结果存储到上下文中，供并行步骤使用
		p.Context[fmt.Sprintf("prev_step_result_%d", prevResultOrder)] = prevResult
	}

	var wg sync.WaitGroup
	errChan := make(chan error, len(groupOrders))

	// 并行执行组内所有步骤
	for _, order := range groupOrders {
		wg.Add(1)
		go func(o int) {
			defer wg.Done()
			if err := p.executeStepWithExecutor(job, o, executor); err != nil {
				errChan <- err
			}
		}(order)
	}

	wg.Wait()
	close(errChan)

	// 检查是否有错误
	for err := range errChan {
		if err != nil {
			return err
		}
	}

	return nil
}
func (p *BasePipeline) executeSteps(job *model.RagJob) error {
	// 获取所有步骤顺序并排序
	orders := make([]int, 0, len(p.Steps))
	for order := range p.Steps {
		orders = append(orders, order)
	}

	// 对步骤顺序进行排序
	for i := 0; i < len(orders); i++ {
		for j := i + 1; j < len(orders); j++ {
			if orders[i] > orders[j] {
				orders[i], orders[j] = orders[j], orders[i]
			}
		}
	}

	// 按顺序执行步骤
	for _, order := range orders {
		// 检查是否属于某个并行组
		groupName := ""
		for group, groupOrders := range p.ParallelGroups {
			for _, groupOrder := range groupOrders {
				if groupOrder == order {
					groupName = group
					break
				}
			}
			if groupName != "" {
				break
			}
		}

		if groupName != "" {
			// 并行执行组内的所有步骤
			if err := p.executeParallelGroup(job, groupName); err != nil {
				return err
			}

			// 跳过组内其他步骤，因为已经并行执行过了
			for _, groupOrder := range p.ParallelGroups[groupName] {
				for i, o := range orders {
					if o == groupOrder {
						orders = append(orders[:i], orders[i+1:]...)
						break
					}
				}
			}
		} else {
			// 顺序执行单个步骤
			if err := p.executeStep(job, order); err != nil {
				return err
			}
		}
	}

	return nil
}

// executeStep 执行单个步骤
func (p *BasePipeline) executeStep(job *model.RagJob, order int) error {
	step, exists := p.Steps[order]
	if !exists {
		return fmt.Errorf("step with order %d not found", order)
	}

	stepDB, exists := p.StepDBs[order]
	if !exists {
		return fmt.Errorf("step DB record with order %d not found", order)
	}

	// 如果步骤实现了 BaseStep 接口，设置 StepDB
	if baseStep, ok := step.(interface{ SetStep(*model.RagJobStep) }); ok {
		baseStep.SetStep(stepDB)
	}

	// 准备步骤参数
	parameters := p.PrepareStepParameters(order)

	// 获取RAG Job日志记录器
	ragLogger, err := logger.GetRAGJobLogger(p.Type)
	if err != nil {
		ragLogger = nil // 继续处理，不使用日志记录器
	}

	// 获取步骤名称
	stepName := fmt.Sprintf("%T", step)
	if idx := strings.LastIndex(stepName, "."); idx != -1 {
		stepName = stepName[idx+1:]
	}

	// 记录步骤开始
	if ragLogger != nil {
		paramsJSON, _ := json.Marshal(parameters)
		ragLogger.StepStart(job.JobID, order, stepName, string(paramsJSON))
	}

	stepStartTime := time.Now()

	// 更新步骤状态为处理中
	stepDB.Status = model.RagJobStepStatusProcessing
	stepDB.StartTime = stepStartTime.UnixMilli()

	// 执行步骤
	if err := step.Execute(parameters); err != nil {
		stepDB.CompleteWithError(err.Error())
		stepDB.EndTime = time.Now().UnixMilli()

		// 记录步骤错误
		if ragLogger != nil {
			ragLogger.Errorf("Step %s failed: %v", stepName, err)
			ragLogger.StepEnd(job.JobID, order, stepName, "failed", time.Since(stepStartTime), "")
		}

		// 如果有数据库连接，保存状态到数据库
		if p.DB != nil {
			if saveErr := p.DB.Save(stepDB).Error; saveErr != nil {
				logger.SysErrorf("Failed to save step %d error status: %v", order, saveErr)
			}
		}

		return err
	}

	// 更新当前步骤顺序
	job.CurrentStepOrder = order

	stepDB.EndTime = time.Now().UnixMilli()

	// 记录步骤成功完成
	if ragLogger != nil {
		resultsJSON, _ := json.Marshal(stepDB.Results)
		ragLogger.StepEnd(job.JobID, order, stepName, "success", time.Since(stepStartTime), string(resultsJSON))
	}

	// 如果有数据库连接，保存任务状态到数据库
	if p.DB != nil {
		// 保存步骤状态
		if saveErr := p.DB.Save(stepDB).Error; saveErr != nil {
			logger.SysErrorf("Failed to save step %d status: %v", order, saveErr)
		}

		// 保存任务当前步骤顺序
		if saveErr := p.DB.Model(job).Update("current_step_order", order).Error; saveErr != nil {
			logger.SysErrorf("Failed to save job current step order: %v", saveErr)
		}
	}

	return nil
}

// executeParallelGroup 并行执行组内的所有步骤
func (p *BasePipeline) executeParallelGroup(job *model.RagJob, groupName string) error {
	groupOrders, exists := p.ParallelGroups[groupName]
	if !exists {
		return fmt.Errorf("parallel group %s not found", groupName)
	}

	var wg sync.WaitGroup
	errChan := make(chan error, len(groupOrders))

	// 并行执行组内所有步骤
	for _, order := range groupOrders {
		wg.Add(1)
		go func(o int) {
			defer wg.Done()
			if err := p.executeStep(job, o); err != nil {
				errChan <- err
			}
		}(order)
	}

	wg.Wait()
	close(errChan)

	// 检查是否有错误
	for err := range errChan {
		if err != nil {
			return err
		}
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *BasePipeline) PrepareStepParameters(order int) interface{} {
	// 基础实现，子类可以重写以提供特定的参数
	return map[string]interface{}{
		"order":   order,
		"context": p.Context,
	}
}

// GetStepResult 获取指定步骤的执行结果
func (p *BasePipeline) GetStepResult(order int) (interface{}, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	stepDB, exists := p.StepDBs[order]
	if !exists {
		return nil, fmt.Errorf("step with order %d not found", order)
	}

	if stepDB.Status != model.RagJobStepStatusSuccess {
		return nil, fmt.Errorf("step with order %d has not completed successfully", order)
	}

	if stepDB.Results == "" {
		return nil, nil
	}

	var result interface{}
	if err := json.Unmarshal([]byte(stepDB.Results), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal step results: %w", err)
	}

	return result, nil
}

// GetStepParameters 获取指定步骤的输入参数
func (p *BasePipeline) GetStepParameters(order int) (interface{}, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	stepDB, exists := p.StepDBs[order]
	if !exists {
		return nil, fmt.Errorf("step with order %d not found", order)
	}

	if stepDB.Parameters == "" {
		return nil, nil
	}

	var parameters interface{}
	if err := json.Unmarshal([]byte(stepDB.Parameters), &parameters); err != nil {
		return nil, fmt.Errorf("failed to unmarshal step parameters: %w", err)
	}

	return parameters, nil
}

// GetPreviousSequentialStepResult 获取前一个顺序步骤的执行结果（跳过并行步骤）
func (p *BasePipeline) GetPreviousSequentialStepResult(currentOrder int) (interface{}, error) {
	// 找到前一个顺序步骤的顺序（跳过并行步骤）
	previousOrder := -1
	for order := range p.Steps {
		if order < currentOrder && order > previousOrder {
			// 检查这个步骤是否属于并行组
			isParallelGroup := false
			for _, groupOrders := range p.ParallelGroups {
				for _, groupOrder := range groupOrders {
					if groupOrder == order {
						isParallelGroup = true
						break
					}
				}
				if isParallelGroup {
					break
				}
			}

			// 如果不是并行步骤，或者当前步骤也属于同一个并行组，则认为是有效的上一个步骤
			if !isParallelGroup || p.isInSameParallelGroup(order, currentOrder) {
				previousOrder = order
			}
		}
	}

	if previousOrder == -1 {
		return nil, fmt.Errorf("no previous sequential step found for step %d", currentOrder)
	}

	return p.GetStepResult(previousOrder)
}

// isInSameParallelGroup 检查两个步骤是否属于同一个并行组
func (p *BasePipeline) isInSameParallelGroup(order1, order2 int) bool {
	for _, groupOrders := range p.ParallelGroups {
		order1InGroup := false
		order2InGroup := false

		for _, groupOrder := range groupOrders {
			if groupOrder == order1 {
				order1InGroup = true
			}
			if groupOrder == order2 {
				order2InGroup = true
			}
		}

		if order1InGroup && order2InGroup {
			return true
		}
	}

	return false
}

// GetPreviousStepResult 获取前一步骤的执行结果
func (p *BasePipeline) GetPreviousStepResult(currentOrder int) (interface{}, error) {
	// 找到前一个步骤的顺序
	previousOrder := -1
	for order := range p.Steps {
		if order < currentOrder && order > previousOrder {
			previousOrder = order
		}
	}

	if previousOrder == -1 {
		return nil, fmt.Errorf("no previous step found for step %d", currentOrder)
	}

	return p.GetStepResult(previousOrder)
}

// GetPreviousStepParameters 获取前一步骤的输入参数
func (p *BasePipeline) GetPreviousStepParameters(currentOrder int) (interface{}, error) {
	// 找到前一个步骤的顺序
	previousOrder := -1
	for order := range p.Steps {
		if order < currentOrder && order > previousOrder {
			previousOrder = order
		}
	}

	if previousOrder == -1 {
		return nil, fmt.Errorf("no previous step found for step %d", currentOrder)
	}

	return p.GetStepParameters(previousOrder)
}

// Pipeline 注册机制
var pipelineRegistry = make(map[string]func() Pipeline)

// RegisterPipeline 注册流水线
func RegisterPipeline(pipelineType string, factory func() Pipeline) {
	pipelineRegistry[pipelineType] = factory
}

// GetPipeline 获取流水线实例
func GetPipeline(pipelineType string) (Pipeline, error) {
	factory, exists := pipelineRegistry[pipelineType]
	if !exists {
		return nil, fmt.Errorf("pipeline type %s not found", pipelineType)
	}
	return factory(), nil
}

type CleaningPipelineStepMeta struct {
	Enabled bool
	Config  json.RawMessage
}

func ParseCleaningPipelineProfileSteps(profileJSON string) (map[string]CleaningPipelineStepMeta, error) {
	raw := strings.TrimSpace(profileJSON)
	if raw == "" {
		return nil, fmt.Errorf("清洗管线 profile_json 为空")
	}

	profileBytes := []byte(raw)
	if len(profileBytes) > 0 && profileBytes[0] == '"' {
		var unescaped string
		if err := json.Unmarshal(profileBytes, &unescaped); err != nil {
			return nil, fmt.Errorf("解析清洗管线 profile_json 失败: %w", err)
		}
		profileBytes = []byte(unescaped)
	}

	type profileStep struct {
		Enabled *bool           `json:"enabled"`
		StepKey string          `json:"step_key"`
		Config  json.RawMessage `json:"config"`
	}
	type profile struct {
		Steps []profileStep `json:"steps"`
	}

	var parsed profile
	if err := json.Unmarshal(profileBytes, &parsed); err != nil {
		return nil, fmt.Errorf("解析清洗管线 profile_json 失败: %w", err)
	}

	stepsMap := make(map[string]CleaningPipelineStepMeta, len(parsed.Steps))
	for _, st := range parsed.Steps {
		stepKey := strings.TrimSpace(st.StepKey)
		if stepKey == "" {
			continue
		}
		enabled := true
		if st.Enabled != nil {
			enabled = *st.Enabled
		}
		stepsMap[stepKey] = CleaningPipelineStepMeta{
			Enabled: enabled,
			Config:  st.Config,
		}
	}
	return stepsMap, nil
}

func (p *BasePipeline) ResolveCleaningPipelineProfileByFileID(eid, fileID int64) (*model.File, *model.RagPipelineProfile, map[string]CleaningPipelineStepMeta, error) {
	if p == nil || p.DB == nil {
		return nil, nil, nil, fmt.Errorf("数据库连接为空")
	}

	if cachedFileID, ok := p.Context["cleaning_file_id"].(int64); ok && cachedFileID == fileID {
		cachedFile, okFile := p.Context["cleaning_file"].(*model.File)
		cachedDetail, okDetail := p.Context["cleaning_pipeline_detail"].(*model.RagPipelineProfile)
		cachedSteps, okSteps := p.Context["cleaning_pipeline_steps"].(map[string]CleaningPipelineStepMeta)
		if okFile && okDetail && okSteps {
			return cachedFile, cachedDetail, cachedSteps, nil
		}
	}

	var file model.File
	if err := p.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, err
		}
		return nil, nil, nil, fmt.Errorf("获取文件信息失败: %w", err)
	}

	_, pipelineProfile, err := model.FindHighestPriorityRagRoutingStrategyAndPipelineByFile(p.DB, &file)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, err
		}
		return nil, nil, nil, fmt.Errorf("查找清洗管线配置失败: %w", err)
	}
	if pipelineProfile == nil {
		return nil, nil, nil, fmt.Errorf("未找到生效的清洗管线配置")
	}

	stepsMap, err := ParseCleaningPipelineProfileSteps(pipelineProfile.ProfileJSON)
	if err != nil {
		return nil, nil, nil, err
	}

	filePtr := &file
	p.Context["cleaning_file_id"] = fileID
	p.Context["cleaning_file"] = filePtr
	p.Context["cleaning_pipeline_detail"] = pipelineProfile
	p.Context["cleaning_pipeline_steps"] = stepsMap

	return filePtr, pipelineProfile, stepsMap, nil
}
