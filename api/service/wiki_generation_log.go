package service

import "fmt"

func formatWikiGenerationLog(phase, message string) string {
	return fmt.Sprintf("【Wiki生成】 phase=%s %s", phase, message)
}
