package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionruntime"
	"github.com/53AI/53AIHub/service/actionsystem"
	"gorm.io/gorm"
)

// 主交付物发现错误：executor 自报的文件名不是权威，Host 才是（§12）。
var (
	ErrActionExpectedArtifactMissing = errors.New("expected_artifact_missing")
	ErrActionArtifactAmbiguous       = errors.New("artifact_ambiguous")
	ErrActionArtifactFormatMismatch  = errors.New("artifact_format_mismatch")
)

// renderHostResult 完成一次 Run 的交付：executor 已经直接生成真实 OOXML 主交付物，
// Host 负责命名权威（canonicalize / rename）、真实性校验、归档、注册 Artifact 与
// PDF 预览。PDF 只是 preview derivative，永远不是第二份业务交付物。
func (s *ActionRuntimeService) renderHostResult(ctx context.Context, action *model.ActionRecord, run *model.ActionRunRecord, config ActionRuntimeConfig, workdir string, contract canonicalPrimaryArtifactContract, finalMessage string) error {
	spec, err := buildHostResultSpec(ctx, action, finalMessage, config, contract)
	if err != nil {
		return err
	}
	discovered, err := discoverPrimaryArtifact(ctx, workdir, contract)
	if err != nil {
		return err
	}
	if discovered.Diagnostic != "" {
		logger.SysErrorf("【Action Runtime】主交付物重命名 run_id=%s %s", run.RunID, discovered.Diagnostic)
	}
	store, err := actionruntime.NewArtifactStore(config.ArtifactRoot)
	if err != nil {
		return err
	}
	artifact, err := store.Archive(ctx, run.RunID, workdir, discovered.Path)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrActionArtifactFormatMismatch, err)
	}
	// 校验通过 ≠ 预览可用：LibreOffice 转换失败只降级 preview_url，不影响成果本身。
	event := actionruntime.ActionEvent{
		ID: fmt.Sprintf("%s:%d", run.RunID, run.LastSeq+1), Seq: run.LastSeq + 1, Type: actionruntime.EventArtifact, Runtime: "host-renderer", RunID: run.RunID,
		ExternalMethod: "host/result-renderer", Artifact: &artifact,
	}
	preview, previewErr := actionruntime.RenderArtifactPreview(ctx, config.PreviewBinary, workdir, discovered.Path, filepath.Join(config.PreviewRoot, run.RunID), contract.Format)
	if previewErr != nil {
		event.PreviewStatus, event.PreviewErrorCode = actionruntime.ClassifyPreviewFailure(previewErr)
		logger.SysErrorf("【Action Runtime】PDF 预览失败（成果仍然成功） run_id=%s artifact=%s preview_status=%s preview_error_code=%s err=%v", run.RunID, artifact.Name, event.PreviewStatus, event.PreviewErrorCode, previewErr)
	} else {
		event.Preview = &preview
		event.PreviewStatus = actionruntime.PreviewStatusAvailable
	}
	specJSON, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	// ResultSpec 是 Run 的输出，不再升级为独立业务实体/表。
	if err := model.DB.WithContext(ctx).Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).
		Update("output_json", model.LongText(specJSON)).Error; err != nil {
		return err
	}
	event.Payload = map[string]any{
		"result_spec_version": spec.ResultSpecVersion,
		"renderer_version":    spec.RendererVersion,
		"template_version":    spec.TemplateVersion,
		"artifact_format":     string(contract.Format),
	}
	if discovered.Diagnostic != "" {
		event.Payload["artifact_diagnostic"] = discovered.Diagnostic
	}
	if previewErr != nil {
		event.Payload["preview_unavailable"] = true
	}
	if err := s.persistActionEvent(ctx, run, action, event); err != nil {
		return err
	}
	run.LastSeq = event.Seq
	return nil
}

// discoveredPrimaryArtifact 是 Host 校验通过的主交付物文件。
type discoveredPrimaryArtifact struct {
	Path       string
	Diagnostic string
}

// discoverPrimaryArtifact 在工作目录里寻找唯一主交付物：
//   - canonical filename 存在 → 直接校验（case_A）；
//   - 否则工作目录里恰好只有一个同格式候选 → 重命名为 canonical filename（case_B）；
//   - 没有候选 → expected_artifact_missing（case_C）；
//   - 多个候选 → artifact_ambiguous（case_D）；
//   - 文件名对但真实格式不对 → artifact_format_mismatch（case_E）。
func discoverPrimaryArtifact(ctx context.Context, workdir string, contract canonicalPrimaryArtifactContract) (discoveredPrimaryArtifact, error) {
	canonicalPath := filepath.Join(workdir, contract.Filename)
	if info, err := os.Lstat(canonicalPath); err == nil && info.Mode().IsRegular() {
		if _, err := actionruntime.VerifyOOXMLArtifact(ctx, workdir, canonicalPath, contract.Format, 0); err != nil {
			return discoveredPrimaryArtifact{}, fmt.Errorf("%w: %v", ErrActionArtifactFormatMismatch, err)
		}
		return discoveredPrimaryArtifact{Path: canonicalPath}, nil
	}
	candidates, err := formatCandidates(workdir, contract.Format)
	if err != nil {
		return discoveredPrimaryArtifact{}, err
	}
	switch len(candidates) {
	case 0:
		return discoveredPrimaryArtifact{}, fmt.Errorf("%w: %s", ErrActionExpectedArtifactMissing, contract.Filename)
	case 1:
	default:
		names := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			names = append(names, filepath.Base(candidate))
		}
		return discoveredPrimaryArtifact{}, fmt.Errorf("%w: %s", ErrActionArtifactAmbiguous, strings.Join(names, ", "))
	}
	if err := os.Rename(candidates[0], canonicalPath); err != nil {
		return discoveredPrimaryArtifact{}, err
	}
	if _, err := actionruntime.VerifyOOXMLArtifact(ctx, workdir, canonicalPath, contract.Format, 0); err != nil {
		return discoveredPrimaryArtifact{}, fmt.Errorf("%w: %v", ErrActionArtifactFormatMismatch, err)
	}
	return discoveredPrimaryArtifact{
		Path:       canonicalPath,
		Diagnostic: fmt.Sprintf("artifact_filename_canonicalized: %s -> %s", filepath.Base(candidates[0]), contract.Filename),
	}, nil
}

// formatCandidates 列出工作目录里真实存在的同格式候选文件（跳过隐藏目录）。
func formatCandidates(workdir string, format actionsystem.DeliverableFormat) ([]string, error) {
	candidates := make([]string, 0, 4)
	err := filepath.WalkDir(workdir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != workdir && strings.HasPrefix(entry.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if candidateFormat, ok := actionsystem.FormatForExtension(filepath.Ext(entry.Name())); !ok || candidateFormat != format {
			return nil
		}
		candidates = append(candidates, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(candidates)
	return candidates, nil
}

// buildHostResultSpec 把 executor 的最终消息解析成 ResultSpec，并把对外可见的
// title 收敛为 Plan 的主交付物标题：用户确认过的 Plan 高于 executor 自报标题。
func buildHostResultSpec(ctx context.Context, action *model.ActionRecord, finalMessage string, config ActionRuntimeConfig, contract canonicalPrimaryArtifactContract) (actionruntime.ResultSpec, error) {
	if strings.TrimSpace(finalMessage) == "" {
		return actionruntime.ResultSpec{}, fmt.Errorf("runtime returned no deliverable message")
	}
	spec, err := actionruntime.ParseResultSpec([]byte(finalMessage))
	if err != nil {
		return actionruntime.ResultSpec{}, fmt.Errorf("parse Codex ResultSpec: %w", err)
	}
	spec.ResultSpecVersion = resultConfigValue(config.ResultSpecVersion, "result-spec-v1")
	spec.RendererVersion = RendererVersionForFormat(contract.Format)
	spec.TemplateVersion = resultConfigValue(config.TemplateVersion, "template-v1")
	if executorTitle := strings.TrimSpace(spec.Title); executorTitle != "" && executorTitle != contract.Title {
		logger.SysErrorf("【Action Runtime】executor 自报标题与 Plan 不一致，采用 Plan：plan=%q executor=%q", contract.Title, executorTitle)
	}
	spec.Title = contract.Title
	if sources, sourceErr := canonicalResultSources(ctx, action); sourceErr != nil {
		return actionruntime.ResultSpec{}, sourceErr
	} else if len(sources) > 0 {
		spec.Sources = sources
	}
	return spec, nil
}

func resultConfigValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func canonicalResultSources(ctx context.Context, action *model.ActionRecord) ([]actionruntime.ResultSpecSource, error) {
	if action == nil || action.ActionType != ActionTypeExecutePlan {
		return nil, nil
	}
	plan, err := model.GetActionPlanByActionID(ctx, action.Eid, action.ActionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	aggregate, err := model.GetActionPlanForUser(ctx, action.Eid, action.OwnerID, plan.PlanID)
	if err != nil {
		return nil, err
	}
	sources := make([]actionruntime.ResultSpecSource, 0, len(aggregate.SourceRefs))
	for _, ref := range aggregate.SourceRefs {
		if ref == nil {
			continue
		}
		sources = append(sources, actionruntime.ResultSpecSource{Role: ref.Role, SourceType: ref.SourceType, CanonicalID: ref.CanonicalID, SourceVersion: ref.SourceVersion})
	}
	return sources, nil
}

// actionArtifactDeliveryCode 把交付失败映射成稳定的 error code，便于运维区分
// 「文件没生成」「候选不唯一」「真实格式不对」「ResultSpec 不合格」。
func actionArtifactDeliveryCode(err error) actionruntime.ErrorCode {
	switch {
	case errors.Is(err, ErrActionExpectedArtifactMissing):
		return actionruntime.ErrorCodeExpectedArtifactMissing
	case errors.Is(err, ErrActionArtifactAmbiguous):
		return actionruntime.ErrorCodeArtifactAmbiguous
	case errors.Is(err, ErrActionArtifactFormatMismatch):
		return actionruntime.ErrorCodeArtifactFormatMismatch
	default:
		return actionruntime.ResultSpecErrorCode(err)
	}
}
