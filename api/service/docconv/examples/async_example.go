//go:build example

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/service/docconv"
	"github.com/joho/godotenv"
)

func main() {
	// 加载环境变量
	if err := godotenv.Load("../../../.env"); err != nil {
		log.Fatalf("Failed to load /code/AgentHub/.env: %v", err)
	}
	// 同步赋值给 config 包，因 config 变量在包初始化时已读取环境
	config.REDIS_CONN = os.Getenv("REDIS_CONN")

	// 初始化 Redis 等组件
	common.Init()

	// 创建服务
	service := docconv.NewService()

	// 健康检查
	fmt.Println("Checking service health...")
	err := service.Health(context.Background())
	if err != nil {
		log.Fatalf("Health check failed: %v", err)
	}
	fmt.Println("✓ Service is healthy")

	ctx := context.Background()

	// 异步转换文档（入队）
	fmt.Println("Starting async conversion...")
	sourceURL := "https://ibosapp.oss-cn-hangzhou.aliyuncs.com/53aikm_test/%E5%85%A8%E9%83%A8%E6%98%AF%E5%9B%BE%E7%89%87.docx"
	parserType := "markitdown"

	taskID, err := service.ConvertAsync(ctx, sourceURL, parserType)
	if err != nil {
		log.Fatalf("Failed to enqueue task: %v", err)
	}
	fmt.Printf("✓ Task enqueued with ID: %s\n", taskID)

	// 检查队列大小
	size, err := service.GetQueueSize(ctx)
	if err != nil {
		log.Fatalf("Failed to get queue size: %v", err)
	}
	fmt.Printf("✓ Queue size: %d\n", size)

	// 启动消费者处理队列
	fmt.Println("Starting worker to process queue...")
	workerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// 启动1个消费者
	service.StartWorker(workerCtx, 1)

	// 模拟处理队列中的任务
	fmt.Println("Processing queue...")
	for i := 0; i < 5; i++ {
		err = service.ProcessQueue(ctx)
		if err != nil {
			fmt.Printf("Process queue iteration %d failed: %v\n", i+1, err)
		} else {
			fmt.Printf("✓ Process queue iteration %d completed\n", i+1)
		}
		time.Sleep(2 * time.Second)
	}

	// 检查最终队列大小
	finalSize, err := service.GetQueueSize(ctx)
	if err != nil {
		log.Fatalf("Failed to get final queue size: %v", err)
	}
	fmt.Printf("✓ Final queue size: %d\n", finalSize)

	fmt.Println("Async example completed!")
}
