package steps

import (
	"encoding/json"
	"strings"

	"github.com/53AI/53AIHub/model"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
)

func isWikiPageGenerationActive(job *model.RagJob) bool {
	if job == nil || strings.TrimSpace(job.RuntimeProfile) == "" {
		return false
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		return false
	}

	for _, step := range profile.Steps {
		if strings.TrimSpace(step.StepKey) != "wiki_page_generation" {
			continue
		}
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = v2model.RunModeAuto
			} else {
				runMode = v2model.RunModeManual
			}
		}
		return runMode == v2model.RunModeAuto
	}

	return false
}
