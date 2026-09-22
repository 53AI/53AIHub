package actionruntime

import (
	"context"
	"path/filepath"

	"github.com/53AI/53AIHub/service/actionsystem"
)

// ArtifactPipeline turns an adapter-reported artifact into a host-owned
// archived artifact and, when configured, a PDF preview.
type ArtifactPipeline struct {
	store         *ArtifactStore
	previewRoot   string
	previewBinary string
}

func NewArtifactPipeline(store *ArtifactStore, previewRoot, previewBinary string) *ArtifactPipeline {
	return &ArtifactPipeline{store: store, previewRoot: previewRoot, previewBinary: previewBinary}
}

func (p *ArtifactPipeline) ProcessEvents(ctx context.Context, action ActionSpec, run ActionRun, event ActionEvent) []ActionEvent {
	if p == nil || event.Type != EventRunCompleted || len(action.ExpectedArtifacts) == 0 {
		return []ActionEvent{p.Process(ctx, action, run, event)}
	}
	processed := make([]ActionEvent, 0, len(action.ExpectedArtifacts)+1)
	for _, path := range action.ExpectedArtifacts {
		artifactEvent := ActionEvent{
			Type: EventArtifact,
			Artifact: &ActionArtifact{
				Name: filepath.Base(path),
				Path: path,
			},
		}
		artifactEvent = p.Process(ctx, action, run, artifactEvent)
		processed = append(processed, artifactEvent)
		if artifactEvent.Type == EventRunFailed {
			return processed
		}
	}
	return append(processed, event)
}

func (p *ArtifactPipeline) Process(ctx context.Context, action ActionSpec, run ActionRun, event ActionEvent) ActionEvent {
	if p == nil || event.Type != EventArtifact || event.Artifact == nil {
		return event
	}
	if p.store == nil {
		return artifactFailure(event, "artifact_store_unavailable", "artifact store is not configured")
	}
	sourcePath := event.Artifact.Path
	if !filepath.IsAbs(sourcePath) {
		sourcePath = filepath.Join(action.WorkDir, sourcePath)
	}
	if _, validationErr := VerifyArtifactInWorkspace(ctx, action.WorkDir, sourcePath, 0); validationErr != nil {
		return artifactFailure(event, "artifact_validation_failed", "artifact failed Host validation")
	}
	archived, err := p.store.Archive(ctx, run.ID, action.WorkDir, sourcePath)
	if err != nil {
		return artifactFailure(event, "artifact_archive_failed", "artifact could not be archived")
	}
	event.Artifact = &archived
	if format, ok := actionsystem.FormatForExtension(filepath.Ext(archived.Name)); ok && p.previewRoot != "" {
		if !safeArtifactSegment(run.ID) {
			return artifactFailure(event, "artifact_preview_failed", ErrArtifactRunIDInvalid.Error())
		}
		preview, previewErr := RenderArtifactPreview(ctx, p.previewBinary, action.WorkDir, sourcePath, filepath.Join(p.previewRoot, run.ID), format)
		if previewErr != nil {
			// 预览只是派生能力：Host 拿不到 PDF 时降级成明确的状态与安全 error code，
			// 绝不能让已经校验通过的交付物变成 Run 失败。
			event.PreviewStatus, event.PreviewErrorCode = ClassifyPreviewFailure(previewErr)
			event.Diagnostic = previewErr.Error()
			return event
		}
		event.Preview = &preview
		event.PreviewStatus = PreviewStatusAvailable
	}
	return event
}

func artifactFailure(event ActionEvent, code, message string) ActionEvent {
	event.Type = EventRunFailed
	event.ErrorCode = code
	event.ErrorMessage = message
	event.Artifact = nil
	event.Preview = nil
	return event
}
