package service

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"regexp"
	"sort"
	"strings"
)

// RecordingEvaluationDataset 是 A0/A1/A2 共用的脱敏评测数据契约。
// 真实会议原文不进入仓库；仓库只保存契约、脱敏样例和运行清单。
type RecordingEvaluationDataset struct {
	Version string                    `json:"dataset_version"`
	Cases   []RecordingEvaluationCase `json:"cases"`
}

type RecordingEvaluationCase struct {
	CaseID          string                            `json:"case_id"`
	Split           string                            `json:"split"`
	Scene           string                            `json:"primary_scene"`
	SecondaryDomain []string                          `json:"secondary_domains"`
	Topics          []string                          `json:"topics"`
	Question        string                            `json:"question"`
	Intent          string                            `json:"intent"`
	Meeting         RecordingEvaluationMeeting        `json:"meeting"`
	Access          RecordingEvaluationAccessScope    `json:"access_scope"`
	Knowledge       RecordingEvaluationKnowledgeScope `json:"knowledge_scope"`
	MustFind        []RecordingEvaluationExpectation  `json:"must_find"`
	MustNotSay      []string                          `json:"must_not_say"`
}

type RecordingEvaluationMeeting struct {
	MinutesHash string   `json:"minutes_hash"`
	SegmentIDs  []string `json:"segment_ids"`
	Claims      []string `json:"claims"`
}

type RecordingEvaluationAccessScope struct {
	EnterpriseID string   `json:"enterprise_id"`
	UserID       string   `json:"user_id"`
	FileIDs      []string `json:"file_ids"`
}

type RecordingEvaluationKnowledgeScope struct {
	LibraryIDs []string `json:"library_ids"`
	FolderIDs  []string `json:"folder_ids"`
	FileIDs    []string `json:"file_ids"`
}

type RecordingEvaluationExpectation struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Content  string `json:"content"`
	Weight   int    `json:"weight"`
	Evidence string `json:"evidence"`
}

type RecordingEvaluationScore struct {
	CaseID                string   `json:"case_id"`
	MustFindScore         float64  `json:"must_find_score"`
	WeightedMustFindScore float64  `json:"weighted_must_find_score"`
	MustNotSayPass        bool     `json:"must_not_say_pass"`
	CitationPass          bool     `json:"citation_pass"`
	PermissionPass        bool     `json:"permission_pass"`
	RuntimeConsistent     bool     `json:"runtime_consistent"`
	OverallScore          float64  `json:"overall_score"`
	Matched               []string `json:"matched,omitempty"`
	Missing               []string `json:"missing,omitempty"`
	Forbidden             []string `json:"forbidden,omitempty"`
}

type RecordingEvaluationEvidence struct {
	Citations           []string `json:"citations,omitempty"`
	PermissionViolation bool     `json:"permission_violation"`
	RuntimeConsistent   bool     `json:"runtime_consistent"`
}

type RecordingEvaluationRunMetrics struct {
	CaseCount     int   `json:"case_count"`
	P50LatencyMs  int64 `json:"p50_latency_ms"`
	P95LatencyMs  int64 `json:"p95_latency_ms"`
	TotalTokens   int64 `json:"total_tokens"`
	LLMCalls      int   `json:"llm_calls"`
	DegradedCases int   `json:"degraded_cases"`
}

// RecordingEvaluationCaseResultInput is the externally collected result for
// one case. It intentionally keeps runtime output separate from the dataset so
// the same immutable cases can be replayed against A0, A1 and A2.
type RecordingEvaluationCaseResultInput struct {
	CaseID             string                      `json:"case_id"`
	Output             string                      `json:"output,omitempty"`
	Evidence           RecordingEvaluationEvidence `json:"evidence"`
	LatencyMs          int64                       `json:"latency_ms"`
	InputTokens        int64                       `json:"input_tokens"`
	OutputTokens       int64                       `json:"output_tokens"`
	LLMCalls           int                         `json:"llm_calls"`
	DegradationReasons []string                    `json:"degradation_reasons,omitempty"`
	Error              string                      `json:"error,omitempty"`
}

type RecordingEvaluationCaseResult struct {
	CaseID             string                      `json:"case_id"`
	Output             string                      `json:"output,omitempty"`
	Evidence           RecordingEvaluationEvidence `json:"evidence"`
	Score              RecordingEvaluationScore    `json:"score"`
	LatencyMs          int64                       `json:"latency_ms"`
	InputTokens        int64                       `json:"input_tokens"`
	OutputTokens       int64                       `json:"output_tokens"`
	LLMCalls           int                         `json:"llm_calls"`
	DegradationReasons []string                    `json:"degradation_reasons,omitempty"`
	Error              string                      `json:"error,omitempty"`
}

type RecordingEvaluationRun struct {
	Manifest RecordingEvaluationRunManifest  `json:"manifest"`
	Results  []RecordingEvaluationCaseResult `json:"case_results"`
	Metrics  RecordingEvaluationRunMetrics   `json:"metrics"`
}

type RecordingProductAcceptanceEvidence struct {
	DeploymentCommit string   `json:"deployment_commit"`
	Environment      string   `json:"environment"`
	TestAccountAlias string   `json:"test_account_alias"`
	NetworkTraceRef  string   `json:"network_trace_ref"`
	ConsoleTraceRef  string   `json:"console_trace_ref"`
	ServiceTraceIDs  []string `json:"service_trace_ids"`
	OwnerConclusion  string   `json:"owner_conclusion"`
	Accepted         bool     `json:"accepted"`
}

type RecordingEvaluationRunManifest struct {
	RunID          string            `json:"run_id"`
	Variant        string            `json:"variant"`
	DatasetVersion string            `json:"dataset_version"`
	ScorerVersion  string            `json:"scorer_version"`
	BackendCommit  string            `json:"backend_commit"`
	FrontendCommit string            `json:"frontend_commit"`
	Model          string            `json:"model"`
	PromptHash     string            `json:"prompt_hash"`
	FeatureFlags   map[string]string `json:"feature_flags"`
	CreatedAtUnix  int64             `json:"created_at_unix"`
	ExternalData   bool              `json:"external_data"`
}

type RecordingEvaluationGateInput struct {
	HardGatesPass            bool
	SevereMisleadingCount    int
	MustNotSayRateA2         float64
	MustNotSayRateA0         float64
	ApplicablePreferenceRate float64
	SubstantiallyWorseRate   float64
	BudgetPass               bool
	ExternalAcceptancePassed bool
}

type RecordingEvaluationGateCheck struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Reason string `json:"reason"`
}

type RecordingEvaluationGateReport struct {
	Conclusion string                         `json:"conclusion"`
	AllowA3    bool                           `json:"allow_a3"`
	Checks     []RecordingEvaluationGateCheck `json:"checks"`
}

type RecordingBlindReviewItem struct {
	BlindID string `json:"blind_id"`
	CaseID  string `json:"case_id"`
}

type RecordingBlindReviewMapping struct {
	BlindID string `json:"blind_id"`
	Variant string `json:"variant"`
}

type RecordingEvaluationPairDelta struct {
	CaseID         string  `json:"case_id"`
	A0Score        float64 `json:"a0_score"`
	A1Score        float64 `json:"a1_score"`
	A2Score        float64 `json:"a2_score"`
	A2DeltaA0      float64 `json:"a2_delta_a0"`
	Classification string  `json:"classification"`
}

var recordingEvaluationRunIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$`)

const (
	recordingEvaluationSplitDevelopment = "development"
	recordingEvaluationSplitHeldOut     = "held_out"
)

// DecodeRecordingEvaluationDataset 解码普通数据 JSON；它不是 LLM 原始响应，
// 因此使用标准 encoding/json，并拒绝拼写错误或未定义的业务字段。
func DecodeRecordingEvaluationDataset(data []byte) (*RecordingEvaluationDataset, error) {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	var dataset RecordingEvaluationDataset
	if err := decoder.Decode(&dataset); err != nil {
		return nil, fmt.Errorf("decode recording evaluation dataset: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("decode recording evaluation dataset: multiple JSON values")
		}
		return nil, fmt.Errorf("decode recording evaluation dataset trailing value: %w", err)
	}
	if err := ValidateRecordingEvaluationDataset(&dataset); err != nil {
		return nil, err
	}
	return &dataset, nil
}

func ValidateRecordingEvaluationDataset(dataset *RecordingEvaluationDataset) error {
	if dataset == nil {
		return fmt.Errorf("recording evaluation dataset is nil")
	}
	if strings.TrimSpace(dataset.Version) == "" {
		return fmt.Errorf("dataset_version is required")
	}
	if len(dataset.Cases) == 0 {
		return fmt.Errorf("cases must not be empty")
	}
	seenCases := make(map[string]struct{}, len(dataset.Cases))
	for index := range dataset.Cases {
		if err := validateRecordingEvaluationCase(&dataset.Cases[index], index, seenCases); err != nil {
			return err
		}
	}
	return nil
}

func ValidateRecordingEvaluationRunManifest(manifest *RecordingEvaluationRunManifest) error {
	if manifest == nil || !recordingEvaluationRunIDPattern.MatchString(strings.TrimSpace(manifest.RunID)) {
		return fmt.Errorf("run_id is required and must be a stable identifier")
	}
	if manifest.Variant != "A0" && manifest.Variant != "A1" && manifest.Variant != "A2" {
		return fmt.Errorf("variant must be A0, A1 or A2")
	}
	if strings.TrimSpace(manifest.DatasetVersion) == "" || strings.TrimSpace(manifest.ScorerVersion) == "" || strings.TrimSpace(manifest.BackendCommit) == "" {
		return fmt.Errorf("dataset_version, scorer_version and backend_commit are required")
	}
	if manifest.CreatedAtUnix <= 0 {
		return fmt.Errorf("created_at_unix must be positive")
	}
	return nil
}

// BuildRecordingEvaluationRun pairs every collected result with the immutable
// dataset case in dataset order, scores it, and derives the run-level budget
// metrics. It rejects partial or cross-dataset result sets so A0/A1/A2 remain
// directly comparable.
func BuildRecordingEvaluationRun(manifest RecordingEvaluationRunManifest, dataset *RecordingEvaluationDataset, inputs []RecordingEvaluationCaseResultInput) (*RecordingEvaluationRun, error) {
	if err := ValidateRecordingEvaluationRunManifest(&manifest); err != nil {
		return nil, err
	}
	if err := ValidateRecordingEvaluationDataset(dataset); err != nil {
		return nil, err
	}
	if manifest.DatasetVersion != dataset.Version {
		return nil, fmt.Errorf("evaluation manifest dataset_version %q does not match dataset %q", manifest.DatasetVersion, dataset.Version)
	}
	if len(inputs) != len(dataset.Cases) {
		return nil, fmt.Errorf("evaluation result count %d does not match dataset case count %d", len(inputs), len(dataset.Cases))
	}

	byCaseID := make(map[string]RecordingEvaluationCaseResultInput, len(inputs))
	for index, input := range inputs {
		input.CaseID = strings.TrimSpace(input.CaseID)
		if input.CaseID == "" {
			return nil, fmt.Errorf("evaluation result[%d].case_id is required", index)
		}
		if _, exists := byCaseID[input.CaseID]; exists {
			return nil, fmt.Errorf("evaluation result case_id %q is duplicated", input.CaseID)
		}
		if _, exists := findRecordingEvaluationCase(dataset.Cases, input.CaseID); !exists {
			return nil, fmt.Errorf("evaluation result case_id %q is not in dataset", input.CaseID)
		}
		if strings.TrimSpace(input.Output) == "" && strings.TrimSpace(input.Error) == "" {
			return nil, fmt.Errorf("evaluation result case_id %q requires output or error", input.CaseID)
		}
		if input.LatencyMs < 0 || input.InputTokens < 0 || input.OutputTokens < 0 || input.LLMCalls < 0 {
			return nil, fmt.Errorf("evaluation result case_id %q contains negative runtime metrics", input.CaseID)
		}
		input.DegradationReasons = normalizeRecordingEvaluationReasons(input.DegradationReasons)
		byCaseID[input.CaseID] = input
	}

	results := make([]RecordingEvaluationCaseResult, 0, len(dataset.Cases))
	durations := make([]int64, 0, len(dataset.Cases))
	var totalTokens int64
	var llmCalls, degradedCases int
	for index := range dataset.Cases {
		item := &dataset.Cases[index]
		input, exists := byCaseID[item.CaseID]
		if !exists {
			return nil, fmt.Errorf("evaluation result is missing dataset case_id %q", item.CaseID)
		}
		result := RecordingEvaluationCaseResult{
			CaseID:             item.CaseID,
			Output:             input.Output,
			Evidence:           input.Evidence,
			Score:              ScoreRecordingEvaluationCaseDetailed(item, input.Output, input.Evidence),
			LatencyMs:          input.LatencyMs,
			InputTokens:        input.InputTokens,
			OutputTokens:       input.OutputTokens,
			LLMCalls:           input.LLMCalls,
			DegradationReasons: append([]string(nil), input.DegradationReasons...),
			Error:              strings.TrimSpace(input.Error),
		}
		results = append(results, result)
		durations = append(durations, input.LatencyMs)
		totalTokens += input.InputTokens + input.OutputTokens
		llmCalls += input.LLMCalls
		if len(input.DegradationReasons) > 0 || result.Error != "" {
			degradedCases++
		}
	}

	return &RecordingEvaluationRun{
		Manifest: manifest,
		Results:  results,
		Metrics:  SummarizeRecordingEvaluationRun(durations, totalTokens, llmCalls, degradedCases),
	}, nil
}

func findRecordingEvaluationCase(cases []RecordingEvaluationCase, caseID string) (*RecordingEvaluationCase, bool) {
	for index := range cases {
		if cases[index].CaseID == caseID {
			return &cases[index], true
		}
	}
	return nil, false
}

func normalizeRecordingEvaluationReasons(reasons []string) []string {
	seen := make(map[string]struct{}, len(reasons))
	result := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			continue
		}
		if _, exists := seen[reason]; exists {
			continue
		}
		seen[reason] = struct{}{}
		result = append(result, reason)
	}
	sort.Strings(result)
	return result
}

func ValidateRecordingEvaluationRunSet(manifests []RecordingEvaluationRunManifest) error {
	if len(manifests) != 3 {
		return fmt.Errorf("A0/A1/A2 run set must contain exactly three manifests")
	}
	seenVariants := make(map[string]struct{}, len(manifests))
	var datasetVersion, scorerVersion string
	for index := range manifests {
		manifest := &manifests[index]
		if err := ValidateRecordingEvaluationRunManifest(manifest); err != nil {
			return fmt.Errorf("manifest[%d]: %w", index, err)
		}
		if _, exists := seenVariants[manifest.Variant]; exists {
			return fmt.Errorf("duplicate evaluation variant %q", manifest.Variant)
		}
		seenVariants[manifest.Variant] = struct{}{}
		if index == 0 {
			datasetVersion, scorerVersion = manifest.DatasetVersion, manifest.ScorerVersion
		} else if manifest.DatasetVersion != datasetVersion || manifest.ScorerVersion != scorerVersion {
			return fmt.Errorf("evaluation manifests must share dataset and scorer versions")
		}
	}
	for _, variant := range []string{"A0", "A1", "A2"} {
		if _, exists := seenVariants[variant]; !exists {
			return fmt.Errorf("missing evaluation variant %q", variant)
		}
	}
	return nil
}

func ValidateRecordingProductAcceptanceEvidence(evidence *RecordingProductAcceptanceEvidence) error {
	if evidence == nil {
		return fmt.Errorf("product acceptance evidence is nil")
	}
	if strings.TrimSpace(evidence.DeploymentCommit) == "" || strings.TrimSpace(evidence.Environment) == "" || strings.TrimSpace(evidence.TestAccountAlias) == "" {
		return fmt.Errorf("deployment commit, environment and test account alias are required")
	}
	if strings.TrimSpace(evidence.NetworkTraceRef) == "" || strings.TrimSpace(evidence.ConsoleTraceRef) == "" || len(evidence.ServiceTraceIDs) == 0 {
		return fmt.Errorf("network, console and service trace evidence are required")
	}
	if strings.TrimSpace(evidence.OwnerConclusion) == "" {
		return fmt.Errorf("product owner conclusion is required")
	}
	return nil
}

// EvaluateRecordingGate applies hard gates before any average or preference
// metric. Missing external acceptance keeps the result pending rather than
// silently passing on local automation.
func EvaluateRecordingGate(input RecordingEvaluationGateInput) RecordingEvaluationGateReport {
	report := RecordingEvaluationGateReport{Conclusion: "通过", AllowA3: true, Checks: []RecordingEvaluationGateCheck{}}
	add := func(name string, passed bool, reason string) {
		report.Checks = append(report.Checks, RecordingEvaluationGateCheck{Name: name, Passed: passed, Reason: reason})
		if !passed {
			report.AllowA3 = false
		}
	}
	add("hard_gates", input.HardGatesPass, "权限、安全、严重事实错误等硬门槛")
	add("severe_misleading_zero", input.SevereMisleadingCount == 0, fmt.Sprintf("严重误导数=%d", input.SevereMisleadingCount))
	add("must_not_say_not_worse", input.MustNotSayRateA2 <= input.MustNotSayRateA0, fmt.Sprintf("A2=%.4f A0=%.4f", input.MustNotSayRateA2, input.MustNotSayRateA0))
	add("budget", input.BudgetPass, "延迟、Token 与调用量预算")
	if !input.HardGatesPass || input.SevereMisleadingCount != 0 || input.MustNotSayRateA2 > input.MustNotSayRateA0 {
		report.Conclusion = "失败"
		report.AllowA3 = false
	} else if !input.ExternalAcceptancePassed {
		report.Conclusion = "待外部验收"
		report.AllowA3 = false
		report.Checks = append(report.Checks, RecordingEvaluationGateCheck{Name: "external_acceptance", Passed: false, Reason: "缺少真实账号、部署和产品负责人验收证据"})
	}
	if report.Conclusion == "通过" && (!input.BudgetPass || input.ApplicablePreferenceRate < 0.6 || input.SubstantiallyWorseRate > 0.1) {
		report.Conclusion = "条件通过"
		report.AllowA3 = false
	}
	return report
}

// BuildRecordingBlindReviewOrder creates a reproducible presentation order;
// the reviewer-facing items intentionally contain no A0/A1/A2 label. The
// mapping is stored separately and must not be shown until scoring is done.
func BuildRecordingBlindReviewOrder(caseIDs, variants []string, seed int64) ([]RecordingBlindReviewItem, []RecordingBlindReviewMapping, error) {
	if len(caseIDs) == 0 || len(variants) == 0 {
		return nil, nil, fmt.Errorf("blind review cases and variants must not be empty")
	}
	for _, variant := range variants {
		if variant != "A0" && variant != "A1" && variant != "A2" {
			return nil, nil, fmt.Errorf("unsupported blind review variant %q", variant)
		}
	}
	type assignment struct{ caseID, variant string }
	assignments := make([]assignment, 0, len(caseIDs)*len(variants))
	for _, caseID := range caseIDs {
		if strings.TrimSpace(caseID) == "" {
			return nil, nil, fmt.Errorf("blind review case id is empty")
		}
		for _, variant := range variants {
			assignments = append(assignments, assignment{caseID: caseID, variant: variant})
		}
	}
	rng := rand.New(rand.NewSource(seed))
	rng.Shuffle(len(assignments), func(i, j int) { assignments[i], assignments[j] = assignments[j], assignments[i] })
	items := make([]RecordingBlindReviewItem, len(assignments))
	mapping := make([]RecordingBlindReviewMapping, len(assignments))
	for index, item := range assignments {
		blindID := fmt.Sprintf("blind-%03d", index+1)
		items[index] = RecordingBlindReviewItem{BlindID: blindID, CaseID: item.caseID}
		mapping[index] = RecordingBlindReviewMapping{BlindID: blindID, Variant: item.variant}
	}
	return items, mapping, nil
}

// CompareRecordingEvaluationVariants performs case-paired comparison only;
// it refuses to invent missing variant results or mix different case sets.
func CompareRecordingEvaluationVariants(a0, a1, a2 map[string]RecordingEvaluationScore) ([]RecordingEvaluationPairDelta, error) {
	if len(a0) == 0 || len(a1) != len(a0) || len(a2) != len(a0) {
		return nil, fmt.Errorf("A0/A1/A2 result sets must have identical non-empty size")
	}
	result := make([]RecordingEvaluationPairDelta, 0, len(a0))
	for caseID, baseline := range a0 {
		one, oneOK := a1[caseID]
		two, twoOK := a2[caseID]
		if !oneOK || !twoOK {
			return nil, fmt.Errorf("case %q is missing from paired results", caseID)
		}
		delta := two.OverallScore - baseline.OverallScore
		classification := "tie"
		if delta > 0 {
			classification = "better"
		} else if delta < 0 {
			classification = "worse"
		}
		result = append(result, RecordingEvaluationPairDelta{CaseID: caseID, A0Score: baseline.OverallScore, A1Score: one.OverallScore, A2Score: two.OverallScore, A2DeltaA0: delta, Classification: classification})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CaseID < result[j].CaseID })
	return result, nil
}

func validateRecordingEvaluationCase(item *RecordingEvaluationCase, index int, seenCases map[string]struct{}) error {
	item.CaseID = strings.TrimSpace(item.CaseID)
	if item.CaseID == "" {
		return fmt.Errorf("cases[%d].case_id is required", index)
	}
	if _, exists := seenCases[item.CaseID]; exists {
		return fmt.Errorf("cases[%d].case_id %q is duplicated", index, item.CaseID)
	}
	seenCases[item.CaseID] = struct{}{}
	if item.Split != recordingEvaluationSplitDevelopment && item.Split != recordingEvaluationSplitHeldOut {
		return fmt.Errorf("cases[%d].split must be development or held_out", index)
	}
	if strings.TrimSpace(item.Scene) == "" || strings.TrimSpace(item.Question) == "" || strings.TrimSpace(item.Intent) == "" {
		return fmt.Errorf("cases[%d] requires primary_scene, question and intent", index)
	}
	if strings.TrimSpace(item.Access.EnterpriseID) == "" || strings.TrimSpace(item.Access.UserID) == "" {
		return fmt.Errorf("cases[%d].access_scope requires enterprise_id and user_id", index)
	}
	if len(item.Meeting.SegmentIDs) == 0 || strings.TrimSpace(item.Meeting.MinutesHash) == "" {
		return fmt.Errorf("cases[%d].meeting requires minutes_hash and segment_ids", index)
	}
	if len(item.MustFind) == 0 {
		return fmt.Errorf("cases[%d].must_find must not be empty", index)
	}
	seenExpectations := make(map[string]struct{}, len(item.MustFind))
	for expectationIndex := range item.MustFind {
		expectation := &item.MustFind[expectationIndex]
		expectation.ID = strings.TrimSpace(expectation.ID)
		expectation.Kind = strings.TrimSpace(expectation.Kind)
		expectation.Content = strings.TrimSpace(expectation.Content)
		expectation.Evidence = strings.TrimSpace(expectation.Evidence)
		if expectation.ID == "" || expectation.Kind == "" || expectation.Content == "" || expectation.Evidence == "" {
			return fmt.Errorf("cases[%d].must_find[%d] requires id, kind, content and evidence", index, expectationIndex)
		}
		if expectation.Weight <= 0 {
			return fmt.Errorf("cases[%d].must_find[%d].weight must be positive", index, expectationIndex)
		}
		if _, exists := seenExpectations[expectation.ID]; exists {
			return fmt.Errorf("cases[%d].must_find id %q is duplicated", index, expectation.ID)
		}
		seenExpectations[expectation.ID] = struct{}{}
	}
	for notSayIndex := range item.MustNotSay {
		item.MustNotSay[notSayIndex] = strings.TrimSpace(item.MustNotSay[notSayIndex])
		if item.MustNotSay[notSayIndex] == "" {
			return fmt.Errorf("cases[%d].must_not_say[%d] must not be empty", index, notSayIndex)
		}
	}
	return nil
}

// ScoreRecordingEvaluationCase is a deterministic baseline scorer. It scores
// only declared expectations and never treats an unlabelled phrase as proof.
func ScoreRecordingEvaluationCase(item *RecordingEvaluationCase, output string) RecordingEvaluationScore {
	score := RecordingEvaluationScore{CaseID: item.CaseID, MustNotSayPass: true, CitationPass: true, PermissionPass: true, RuntimeConsistent: true}
	output = strings.ToLower(output)
	for _, expectation := range item.MustFind {
		if strings.Contains(output, strings.ToLower(expectation.Content)) {
			score.Matched = append(score.Matched, expectation.ID)
		} else {
			score.Missing = append(score.Missing, expectation.ID)
		}
	}
	if len(item.MustFind) > 0 {
		score.MustFindScore = float64(len(score.Matched)) / float64(len(item.MustFind))
		score.WeightedMustFindScore = score.MustFindScore
	}
	for _, forbidden := range item.MustNotSay {
		if strings.Contains(output, strings.ToLower(forbidden)) {
			score.MustNotSayPass = false
			score.Forbidden = append(score.Forbidden, forbidden)
		}
	}
	if score.MustNotSayPass {
		score.OverallScore = score.MustFindScore
	}
	return score
}

// ScoreRecordingEvaluationCaseDetailed adds evidence and hard-boundary checks
// without changing the legacy text-only scorer used by existing fixtures.
func ScoreRecordingEvaluationCaseDetailed(item *RecordingEvaluationCase, output string, evidence RecordingEvaluationEvidence) RecordingEvaluationScore {
	score := ScoreRecordingEvaluationCase(item, output)
	score.CitationPass = true
	score.PermissionPass = !evidence.PermissionViolation
	score.RuntimeConsistent = evidence.RuntimeConsistent
	citationSet := make(map[string]struct{}, len(evidence.Citations))
	for _, citation := range evidence.Citations {
		citationSet[strings.TrimSpace(citation)] = struct{}{}
	}
	var matchedWeight, totalWeight int
	for _, expectation := range item.MustFind {
		totalWeight += expectation.Weight
		matched := false
		for _, id := range score.Matched {
			if id == expectation.ID {
				matched = true
				break
			}
		}
		if matched {
			matchedWeight += expectation.Weight
			if _, cited := citationSet[expectation.Evidence]; !cited {
				score.CitationPass = false
			}
		}
	}
	if totalWeight > 0 {
		score.WeightedMustFindScore = float64(matchedWeight) / float64(totalWeight)
	}
	if !score.MustNotSayPass || !score.CitationPass || !score.PermissionPass || !score.RuntimeConsistent {
		score.OverallScore = 0
	} else {
		score.OverallScore = score.WeightedMustFindScore
	}
	return score
}

func SummarizeRecordingEvaluationRun(durationsMs []int64, totalTokens int64, llmCalls, degradedCases int) RecordingEvaluationRunMetrics {
	values := append([]int64{}, durationsMs...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	percentile := func(percent int) int64 {
		if len(values) == 0 {
			return 0
		}
		index := (len(values)*percent + 99) / 100
		if index < 1 {
			index = 1
		}
		if index > len(values) {
			index = len(values)
		}
		return values[index-1]
	}
	return RecordingEvaluationRunMetrics{CaseCount: len(values), P50LatencyMs: percentile(50), P95LatencyMs: percentile(95), TotalTokens: totalTokens, LLMCalls: llmCalls, DegradedCases: degradedCases}
}
