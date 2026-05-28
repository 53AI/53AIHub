package relay

import (
	"context"
	"sync"

	"github.com/53AI/53AIHub/service/skill"
)

type intentRoutingPrerequisiteResult struct {
	runnableSkillPathSet map[string]struct{}
	skillSnapshot        *skill.SkillSnapshot
}

func prepareIntentRoutingPrerequisites(
	ctx context.Context,
	shouldLoadRunnableSkillPathSet bool,
	loadRunnable func(context.Context) map[string]struct{},
	buildSnapshot func(context.Context) *skill.SkillSnapshot,
) (map[string]struct{}, *skill.SkillSnapshot) {
	if ctx == nil {
		ctx = context.Background()
	}

	if !shouldLoadRunnableSkillPathSet {
		return nil, buildSnapshot(ctx)
	}

	resultsCh := make(chan intentRoutingPrerequisiteResult, 2)
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		resultsCh <- intentRoutingPrerequisiteResult{
			runnableSkillPathSet: loadRunnable(ctx),
		}
	}()

	go func() {
		defer wg.Done()
		resultsCh <- intentRoutingPrerequisiteResult{
			skillSnapshot: buildSnapshot(ctx),
		}
	}()

	go func() {
		wg.Wait()
		close(resultsCh)
	}()

	var runnableSkillPathSet map[string]struct{}
	var skillSnapshot *skill.SkillSnapshot
	for result := range resultsCh {
		if result.runnableSkillPathSet != nil {
			runnableSkillPathSet = result.runnableSkillPathSet
		}
		if result.skillSnapshot != nil {
			skillSnapshot = result.skillSnapshot
		}
	}

	return runnableSkillPathSet, skillSnapshot
}
