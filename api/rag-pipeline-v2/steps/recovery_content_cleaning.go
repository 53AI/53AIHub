package steps

import (
	"context"
	"encoding/json"

	"github.com/53AI/53AIHub/model"
)

// RecoverContentCleaning content_cleaning 步骤的恢复 handler
// 当前是空实现，recovery 直接返回 nil
func RecoverContentCleaning() func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		return nil
	}
}
