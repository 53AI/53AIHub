package service

import (
	"context"
	"strconv"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
)

func ensureRecordingActionSources(ctx context.Context, eid, fileID, generation int64, parentType, parentID string) (string, string, []*model.ActionSourceRefRecord, error) {
	legacyID := strconv.FormatInt(fileID, 10)
	insight, err := model.EnsureCanonicalSourceIdentity(ctx, eid, model.SourceTypeInsight, model.LegacySourceTypeRecordingFile, legacyID)
	if err != nil {
		return "", "", nil, err
	}
	meeting, err := model.EnsureCanonicalSourceIdentity(ctx, eid, model.SourceTypeMeeting, model.LegacySourceTypeRecordingFile, legacyID)
	if err != nil {
		return "", "", nil, err
	}
	version := ""
	if generation > 0 {
		version = strconv.FormatInt(generation, 10)
	}
	refs := []*model.ActionSourceRefRecord{
		{Role: model.ActionSourceRefRolePrimary, SourceType: model.SourceTypeInsight, CanonicalID: insight.CanonicalID, SourceVersion: version},
		{Role: model.ActionSourceRefRoleRelated, SourceType: model.SourceTypeMeeting, CanonicalID: meeting.CanonicalID, SourceVersion: version},
	}
	if parentType != "" && parentID != "" {
		if err := model.ReplaceActionSourceRefs(ctx, eid, parentType, parentID, refs); err != nil {
			return "", "", nil, err
		}
	}
	return insight.CanonicalID, meeting.CanonicalID, refs, nil
}

func actionSourceRefsDomain(refs []*model.ActionSourceRefRecord) []actionsystem.SourceRef {
	result := make([]actionsystem.SourceRef, 0, len(refs))
	for _, ref := range refs {
		if ref == nil {
			continue
		}
		result = append(result, actionsystem.SourceRef{Role: ref.Role, SourceType: ref.SourceType, CanonicalID: ref.CanonicalID, SourceVersion: ref.SourceVersion})
	}
	return result
}

func actionSourceRefsRecords(refs []actionsystem.SourceRef) []*model.ActionSourceRefRecord {
	result := make([]*model.ActionSourceRefRecord, 0, len(refs))
	for _, ref := range refs {
		result = append(result, &model.ActionSourceRefRecord{Role: ref.Role, SourceType: ref.SourceType, CanonicalID: ref.CanonicalID, SourceVersion: ref.SourceVersion})
	}
	return result
}
