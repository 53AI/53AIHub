//go:build example
// +build example

package main

import (
	"context"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/service/docconv"
	"github.com/joho/godotenv"
)

func main() {
	// 加载环境变量
	if err := godotenv.Load("../../../.env"); err != nil {
		log.Fatalf("Failed to load /code/AgentHub/.env: %v", err)
	}

	// 创建服务
	service := docconv.NewService()

	// 健康检查
	fmt.Println("Checking service health...")
	err := service.Health(context.Background())
	if err != nil {
		log.Fatalf("Health check failed: %v", err)
	}
	fmt.Println("✓ Service is healthy")

	// 同步转换文档
	fmt.Println("Starting sync conversion...")
	sourceURL := "https://ibosapp.oss-cn-hangzhou.aliyuncs.com/53aikm_test/%E5%85%A8%E9%83%A8%E6%98%AF%E5%9B%BE%E7%89%87.docx"
	parserType := "markitdown"

	result, err := service.ConvertSync(context.Background(), sourceURL, parserType)
	if err != nil {
		log.Fatalf("Conversion failed: %v", err)
	}

	fmt.Printf("✓ Conversion completed successfully!\n")
	fmt.Printf("Result length: %d characters\n", len(result))
	fmt.Printf("Result preview: %s...\n", result[:min(200, len(result))])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
