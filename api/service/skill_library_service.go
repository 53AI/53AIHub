package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/model"
)

var (
	ErrSkillImportRequestInvalid        = errors.New("invalid skill import request")
	ErrSkillUploadFileCrossTenant       = errors.New("upload file does not belong to current enterprise")
	ErrSkillImportSourceTypeUnsupported = errors.New("unsupported skill import source type")
	ErrSkillScanNoWorkAIModelConfigured = errors.New("work ai model is not configured")
	ErrSkillScanSkillDeleted            = errors.New("skill is deleted")
	ErrSkillScanMissingSkillMD          = errors.New("skill package missing SKILL.md")
	ErrSkillScanZipPathTraversal        = errors.New("zip contains invalid path traversal entry")
	ErrSkillScanHighRisk                = errors.New("skill scan risk is too high")
)

type GitHubArchiveFetcher func(ctx context.Context, repoURL, ref string) ([]byte, error)

const (
	githubArchiveDownloadTimeoutEnvKey  = "GITHUB_ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS"
	githubArchiveDownloadMaxRetryEnvKey = "GITHUB_ARCHIVE_DOWNLOAD_MAX_RETRY"
	githubArchiveDownloadTimeoutDef     = 60 * time.Second
	githubArchiveDownloadMaxRetryDef    = 2
	githubArchiveDownloadRetryBase      = 300 * time.Millisecond
	maxGitHubArchiveBytes               = 50 << 20 // 50 MiB
)

func githubArchiveDownloadTimeoutValue() time.Duration {
	timeoutSeconds := env.Int(githubArchiveDownloadTimeoutEnvKey, int(githubArchiveDownloadTimeoutDef/time.Second))
	if timeoutSeconds <= 0 {
		timeoutSeconds = int(githubArchiveDownloadTimeoutDef / time.Second)
	}
	return time.Duration(timeoutSeconds) * time.Second
}

func githubArchiveDownloadMaxRetryValue() int {
	maxRetry := env.Int(githubArchiveDownloadMaxRetryEnvKey, githubArchiveDownloadMaxRetryDef)
	if maxRetry <= 0 {
		maxRetry = githubArchiveDownloadMaxRetryDef
	}
	return maxRetry
}

func defaultGitHubArchiveFetcher() GitHubArchiveFetcher {
	timeout := githubArchiveDownloadTimeoutValue()
	maxRetry := githubArchiveDownloadMaxRetryValue()
	client := &http.Client{Timeout: timeout}
	return func(ctx context.Context, repoURL, ref string) ([]byte, error) {
		owner, repo, err := parseGitHubOwnerRepo(repoURL)
		if err != nil {
			return nil, err
		}
		ref = strings.TrimSpace(ref)
		if ref == "" || strings.EqualFold(ref, "HEAD") {
			resolvedRef, resolveErr := resolveGitHubDefaultBranch(ctx, client, owner, repo)
			if resolveErr != nil {
				return nil, resolveErr
			}
			ref = resolvedRef
		}

		downloadURL := fmt.Sprintf("https://codeload.github.com/%s/%s/zip/%s", owner, repo, ref)
		logger.Infof(ctx, "【技能运行】开始下载GitHub技能包: repo_url=%s ref=%s download_url=%s timeout=%s max_retry=%d", repoURL, ref, downloadURL, timeout, maxRetry)

		var lastErr error
		for attempt := 0; attempt < maxRetry; attempt++ {
			attemptStart := time.Now()
			if attempt > 0 {
				backoff := githubArchiveDownloadRetryBase * time.Duration(1<<uint(attempt-1))
				select {
				case <-time.After(backoff):
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}

			req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
			if err != nil {
				return nil, err
			}

			resp, err := client.Do(req)
			if err != nil {
				lastErr = err
				logger.Warnf(ctx, "【技能运行】GitHub技能包下载尝试失败: repo_url=%s ref=%s attempt=%d err=%v elapsed=%s", repoURL, ref, attempt+1, err, time.Since(attemptStart))
				continue
			}

			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				_ = resp.Body.Close()
				if resp.StatusCode == http.StatusNotFound {
					return nil, fmt.Errorf("%w: github_url (status %d)", ErrSkillImportRequestInvalid, resp.StatusCode)
				}
				lastErr = fmt.Errorf("%w: github_url (status %d)", ErrSkillImportRequestInvalid, resp.StatusCode)
				logger.Warnf(ctx, "【技能运行】GitHub技能包下载状态异常: repo_url=%s ref=%s attempt=%d status=%d elapsed=%s", repoURL, ref, attempt+1, resp.StatusCode, time.Since(attemptStart))
				continue
			}

			limited := io.LimitReader(resp.Body, maxGitHubArchiveBytes+1)
			data, err := io.ReadAll(limited)
			_ = resp.Body.Close()
			if err != nil {
				lastErr = err
				logger.Warnf(ctx, "【技能运行】GitHub技能包读取失败: repo_url=%s ref=%s attempt=%d err=%v elapsed=%s", repoURL, ref, attempt+1, err, time.Since(attemptStart))
				continue
			}
			if int64(len(data)) > maxGitHubArchiveBytes {
				return nil, fmt.Errorf("%w: github archive too large", ErrSkillImportRequestInvalid)
			}
			logger.Infof(ctx, "【技能运行】GitHub技能包下载完成: repo_url=%s ref=%s attempt=%d size=%d elapsed=%s", repoURL, ref, attempt+1, len(data), time.Since(attemptStart))
			return data, nil
		}
		return nil, fmt.Errorf("github archive download failed after %d attempts: %w", maxRetry, lastErr)
	}
}

func resolveGitHubDefaultBranch(ctx context.Context, client *http.Client, owner, repo string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://api.github.com/repos/%s/%s", owner, repo), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "53AIHub-SkillImport/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%w: github_url (status %d)", ErrSkillImportRequestInvalid, resp.StatusCode)
	}

	var payload struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	ref := strings.TrimSpace(payload.DefaultBranch)
	if ref == "" {
		ref = "main"
	}
	return ref, nil
}

func parseGitHubOwnerRepo(canonicalRepoURL string) (string, string, error) {
	u, err := url.Parse(strings.TrimSpace(canonicalRepoURL))
	if err != nil || u == nil {
		return "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	p := strings.Trim(u.Path, "/")
	parts := strings.Split(p, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	owner := strings.TrimSpace(parts[0])
	repo := strings.TrimSpace(parts[1])
	repo = strings.TrimSuffix(repo, ".git")
	if owner == "" || repo == "" {
		return "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	return owner, repo, nil
}

type SkillImportRequest struct {
	Eid          int64
	SourceType   string // zip|github
	UploadFileID string // numeric or hashid
	GithubURL    string
	Ref          string
	SkillPath    string // github import extension point, default to repo root
}

type SkillImportJobPayload struct {
	SourceType         string  `json:"source_type"`
	UploadFileID       string  `json:"upload_file_id,omitempty"`
	GithubURL          string  `json:"github_url,omitempty"`
	Ref                string  `json:"ref,omitempty"`
	SkillPath          string  `json:"skill_path,omitempty"`
	PermissionGroupIDs []int64 `json:"permission_group_ids,omitempty"`
}

type SkillImportResult struct {
	ScanJobID  int64  `json:"scan_job_id"`
	ScanStatus string `json:"scan_status"`
}

type SkillLibraryService struct {
	storage       storage.Storage
	scanner       SkillScanner
	llmInvoker    skillLibraryLLMInvoker
	skillRootPath string
	nowFunc       func() time.Time
	githubFetcher GitHubArchiveFetcher
}

func NewSkillLibraryService() *SkillLibraryService {
	return &SkillLibraryService{
		storage:       storage.StorageInstance,
		scanner:       NewDefaultSkillScanner(),
		llmInvoker:    newDefaultSkillLibraryLLMInvoker(),
		skillRootPath: filepath.Join("data", "skills"),
		nowFunc:       time.Now,
		githubFetcher: defaultGitHubArchiveFetcher(),
	}
}

func (s *SkillLibraryService) resolveLLMInvoker() skillLibraryLLMInvoker {
	if s == nil || s.llmInvoker == nil {
		return newDefaultSkillLibraryLLMInvoker()
	}
	return s.llmInvoker
}

func (s *SkillLibraryService) ImportSkill(ctx context.Context, req *SkillImportRequest) (*SkillImportResult, error) {
	if req == nil || req.Eid <= 0 {
		return nil, fmt.Errorf("%w: request/eid", ErrSkillImportRequestInvalid)
	}

	if err := normalizeSkillImportRequest(req); err != nil {
		return nil, err
	}

	switch req.SourceType {
	case model.SkillSourceTypeZip:
		return s.importSkillFromUploadFile(ctx, req)
	case model.SkillSourceTypeGithub:
		return s.importSkillFromGithubRepo(ctx, req)
	default:
		return nil, fmt.Errorf("%w: %s", ErrSkillImportSourceTypeUnsupported, req.SourceType)
	}
}

func (s *SkillLibraryService) submitSkillImportJob(ctx context.Context, req *SkillImportRequest, permissionGroupIDs []int64) (*SkillImportResult, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}

	payload := &SkillImportJobPayload{
		SourceType:         strings.TrimSpace(req.SourceType),
		UploadFileID:       strings.TrimSpace(req.UploadFileID),
		GithubURL:          strings.TrimSpace(req.GithubURL),
		Ref:                strings.TrimSpace(req.Ref),
		SkillPath:          strings.TrimSpace(req.SkillPath),
		PermissionGroupIDs: normalizePermissionGroupIDs(permissionGroupIDs),
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	job := &model.SkillScanJob{
		Eid:          req.Eid,
		Status:       model.SkillScanJobStatusPending,
		ScanPayload:  string(payloadBytes),
		Message:      "导入任务已提交",
		RetryCount:   0,
		StartedTime:  0,
		FinishedTime: 0,
	}
	if err := model.DB.Create(job).Error; err != nil {
		return nil, err
	}

	s.RunAsyncImportJob(context.Background(), job.ID)

	return &SkillImportResult{
		ScanJobID:  job.ID,
		ScanStatus: job.Status,
	}, nil
}

func normalizeSkillImportRequest(req *SkillImportRequest) error {
	if req == nil {
		return fmt.Errorf("%w: request", ErrSkillImportRequestInvalid)
	}

	switch req.SourceType {
	case model.SkillSourceTypeZip:
		return nil
	case model.SkillSourceTypeGithub:
		return normalizeAndValidateGithubImportRequest(req)
	default:
		return fmt.Errorf("%w: %s", ErrSkillImportSourceTypeUnsupported, req.SourceType)
	}
}

const (
	defaultGithubRef       = "HEAD"
	defaultGithubSkillPath = "" // empty means repo root
)

func normalizeAndValidateGithubImportRequest(req *SkillImportRequest) error {
	if req == nil {
		return fmt.Errorf("%w: request", ErrSkillImportRequestInvalid)
	}

	normalizedRepoURL, parsedRef, parsedSkillPath, err := parseGithubImportURL(req.GithubURL)
	if err != nil {
		return err
	}
	req.GithubURL = normalizedRepoURL

	ref := strings.TrimSpace(req.Ref)
	if ref == "" {
		if parsedRef != "" {
			ref = parsedRef
		} else {
			ref = defaultGithubRef
		}
	}
	req.Ref = ref

	skillPath := strings.ReplaceAll(strings.TrimSpace(req.SkillPath), "\\", "/")
	if skillPath == "" || skillPath == "." || skillPath == "/" {
		if parsedSkillPath != "" {
			req.SkillPath = parsedSkillPath
		} else {
			req.SkillPath = defaultGithubSkillPath
		}
		return nil
	}
	if strings.HasPrefix(skillPath, "/") || hasPathTraversalSegment(skillPath) {
		return fmt.Errorf("%w: skill_path", ErrSkillImportRequestInvalid)
	}
	cleaned := path.Clean(skillPath)
	if cleaned == "." || hasPathTraversalSegment(cleaned) {
		cleaned = ""
	}
	if cleaned == "" || cleaned == ".." || hasPathTraversalSegment(cleaned) {
		return fmt.Errorf("%w: skill_path", ErrSkillImportRequestInvalid)
	}
	req.SkillPath = cleaned
	return nil
}

func parseGithubImportURL(raw string) (repoURL, ref, skillPath string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}

	input := raw
	if !strings.Contains(input, "://") {
		input = "https://" + input
	}

	u, err := url.Parse(input)
	if err != nil || u == nil || strings.TrimSpace(u.Host) == "" {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	if u.User != nil {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}

	host := strings.ToLower(strings.TrimSpace(u.Host))
	host = strings.TrimPrefix(host, "www.")
	if host != "github.com" {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	if u.Scheme != "" && u.Scheme != "https" && u.Scheme != "http" {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}

	p := strings.Trim(u.Path, "/")
	parts := strings.Split(p, "/")
	if len(parts) < 2 {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
	owner := strings.TrimSpace(parts[0])
	repo := strings.TrimSpace(parts[1])
	repo = strings.TrimSuffix(repo, ".git")
	if owner == "" || repo == "" {
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}

	if len(parts) == 2 {
		return fmt.Sprintf("https://github.com/%s/%s", owner, repo), "", "", nil
	}

	switch parts[2] {
	case "tree":
		if len(parts) < 4 {
			return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
		}
		ref = strings.TrimSpace(parts[3])
		if ref == "" {
			return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
		}
		if len(parts) > 4 {
			skillPath = path.Clean(strings.Join(parts[4:], "/"))
			if skillPath == "." {
				skillPath = ""
			}
			if skillPath != "" && hasPathTraversalSegment(skillPath) {
				return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
			}
		}
		return fmt.Sprintf("https://github.com/%s/%s", owner, repo), ref, skillPath, nil
	default:
		return "", "", "", fmt.Errorf("%w: github_url", ErrSkillImportRequestInvalid)
	}
}

func hasPathTraversalSegment(raw string) bool {
	cleaned := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	if cleaned == "" {
		return false
	}
	if strings.HasPrefix(cleaned, "/") || path.IsAbs(cleaned) {
		return true
	}
	for _, segment := range strings.Split(cleaned, "/") {
		if segment == ".." {
			return true
		}
	}
	return false
}

func normalizeGithubRepoURL(raw string) (string, error) {
	repoURL, _, _, err := parseGithubImportURL(raw)
	return repoURL, err
}

func (s *SkillLibraryService) RunAsyncScan(ctx context.Context, skillID int64) {
	if skillID <= 0 {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Warnf(ctx, "【技能运行】异步扫描发生panic并已恢复: skill_id=%d panic=%v stack=%s", skillID, r, string(debug.Stack()))
			}
		}()
		_ = s.runScanWorker(context.Background(), &skillID)
	}()
}

func (s *SkillLibraryService) RunAsyncImportJob(ctx context.Context, jobID int64) {
	if jobID <= 0 {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Warnf(ctx, "【技能运行】导入任务异步执行panic并已恢复: job_id=%d panic=%v stack=%s", jobID, r, string(debug.Stack()))
			}
		}()
		_ = s.runImportWorker(context.Background(), jobID)
	}()
}

func (s *SkillLibraryService) RunScanWorkerOnce(ctx context.Context) error {
	return s.runScanWorker(ctx, nil)
}

func (s *SkillLibraryService) RecoverStaleRunningJobs(ctx context.Context) error {
	return s.recoverStaleRunningJobs(ctx)
}
