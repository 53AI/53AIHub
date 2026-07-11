package steps

import "github.com/53AI/53AIHub/model"

type StepProcessor interface {
	Execute(parameters any) error
}

type BaseStep struct {
	Step *model.RagJobStep
	Job  *model.RagJob
}

// SetStep 设置步骤的数据库记录
func (b *BaseStep) SetStep(step *model.RagJobStep) {
	b.Step = step
}

// SetJob 设置任务的引用
func (b *BaseStep) SetJob(job *model.RagJob) {
	b.Job = job
}
