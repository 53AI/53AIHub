package service

import "strings"

// CJK 相关性打分（Phase 2E Slice 1）
//
// 背景（真实失败案例）：
//   - 库里存在正确记录，但全查询 bigram 覆盖率只有 0.190 / 0.200，
//     被固定的 0.34 / 0.40 阈值直接过滤，导致「数据存在却检索不到」。
//   - 根因是长自然语言问句会稀释覆盖率：问句越长，覆盖率分母越大。
//
// 口径：
//  1. 宽召回：SQL 层仍按任一 bigram 召回（不变）。
//  2. 精排序/判活：不再只看全查询覆盖率，而是综合
//     - Coverage：全查询 bigram 覆盖率
//     - LongestRun：内容与查询的最长公共连续片段（字符数），
//     用于识别「问句里夹带的精确业务词」，如「虚构客户甲」「华东客户」(≥3 字)
//     - Score：加权综合分，用于排序
//  3. 自适应下限：覆盖率下限随查询长度放宽（长问句稀释），避免一刀切。
const (
	cjkMinMeaningfulRun = 3    // 连续 ≥3 个字符的公共片段视为有意义的业务词命中
	cjkStrongCoverage   = 0.5  // 覆盖率≥0.5 视为强命中
	cjkFloorLongQuery   = 0.15 // 长问句（≥12 字）的覆盖率下限
	cjkFloorShortQuery  = 0.30 // 短查询（关键词式）仍要求较紧的覆盖率
	cjkFloorQueryRunes  = 12   // 长/短问句分界
	// cjkStrongPhraseScore 是「命中精确业务词」时的排序下限分。
	cjkStrongPhraseScore = 0.6
)

// CJKRelevance 是一次中文相关性打分结果。
type CJKRelevance struct {
	Coverage   float64 `json:"coverage"`
	LongestRun int     `json:"longest_run"`
	Score      float64 `json:"score"`
	Strong     bool    `json:"strong"`
	Relevant   bool    `json:"relevant"`
}

// ScoreCJKRelevance 计算内容与查询的中文相关性。
func ScoreCJKRelevance(content, query string) CJKRelevance {
	query = strings.TrimSpace(query)
	if query == "" || strings.TrimSpace(content) == "" {
		return CJKRelevance{}
	}

	coverage := cjkBigramCoverageLocal(content, query)
	run := cjkLongestCommonRun(content, query)

	// 综合分：覆盖率为基础，长公共片段作为强信号加权。
	score := coverage
	if run >= cjkMinMeaningfulRun {
		// 归一化：按查询长度给出上限 1.0 的加成
		runBonus := float64(run) / float64(len([]rune(query)))
		if runBonus > 1 {
			runBonus = 1
		}
		score = coverage + (1.0-coverage)*runBonus*0.9
	}
	if score > 1 {
		score = 1
	}
	// 命中问句中夹带的精确业务词（连续 ≥3 字）时给排序下限：
	// 这类命中比「分散命中多个 bigram」更可信，应排在更前。
	if run >= cjkMinMeaningfulRun && score < cjkStrongPhraseScore {
		score = cjkStrongPhraseScore
	}

	strong := run >= cjkMinMeaningfulRun || coverage >= cjkStrongCoverage
	relevant := strong || coverage >= AdaptiveCJKFloor(query)

	return CJKRelevance{
		Coverage:   coverage,
		LongestRun: run,
		Score:      score,
		Strong:     strong,
		Relevant:   relevant,
	}
}

// AdaptiveCJKFloor 返回随查询长度放宽的覆盖率下限（长自然语言问句稀释覆盖率）。
func AdaptiveCJKFloor(query string) float64 {
	if len([]rune(strings.TrimSpace(query))) >= cjkFloorQueryRunes {
		return cjkFloorLongQuery
	}
	return cjkFloorShortQuery
}

// cjkBigramCoverageLocal 与既有 bigram 覆盖率口径一致（查询侧 bigram 命中比例）。
func cjkBigramCoverageLocal(content, query string) float64 {
	runes := []rune(strings.TrimSpace(query))
	if len(runes) < 2 {
		if strings.Contains(content, query) {
			return 1
		}
		return 0
	}
	total, hit := 0, 0
	lower := strings.ToLower(content)
	for i := 0; i+2 <= len(runes); i++ {
		bg := string(runes[i : i+2])
		if strings.ContainsAny(bg, " \t，,。;；、：:？?！!「」（）()") {
			continue
		}
		total++
		if strings.Contains(lower, strings.ToLower(bg)) {
			hit++
		}
	}
	if total == 0 {
		return 0
	}
	return float64(hit) / float64(total)
}

// cjkLongestCommonRun 返回内容与查询的最长公共连续片段长度（按 rune 计）。
// 用于识别问句中夹带的精确业务词（如「虚构客户甲」「华东客户」）。
func cjkLongestCommonRun(content, query string) int {
	q := []rune(strings.TrimSpace(query))
	c := []rune(content)
	if len(q) == 0 || len(c) == 0 {
		return 0
	}
	// 仅比较算得上「词」的字符，跳过空白与标点，避免把标点串算成公共片段。
	isMeaningful := func(r rune) bool {
		return !strings.ContainsRune(" \t\r\n，,。;；、：:？?！!「」（）()《》\"'“”‘’-—_/\\|", r)
	}
	best := 0
	// dp[i][j]：以 q[i-1]、c[j-1] 结尾的公共片段长度
	prev := make([]int, len(c)+1)
	cur := make([]int, len(c)+1)
	for i := 1; i <= len(q); i++ {
		for j := 1; j <= len(c); j++ {
			if q[i-1] == c[j-1] && isMeaningful(q[i-1]) {
				cur[j] = prev[j-1] + 1
				if cur[j] > best {
					best = cur[j]
				}
			} else {
				cur[j] = 0
			}
		}
		prev, cur = cur, prev
		for j := range cur {
			cur[j] = 0
		}
	}
	return best
}
