package main

import (
	"fmt"
	"log"
	"math/rand"
	"os"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
)

func main() {
	fmt.Println("=== 文件创建人更新和ES索引工具 ===")

	// 获取企业ID参数 (可选，默认处理所有企业)
	var eid int64 = 0 // 0表示处理所有企业
	if len(os.Args) > 1 {
		if parsedEid, err := strconv.ParseInt(os.Args[1], 10, 64); err == nil {
			eid = parsedEid
		}
	}
	if eid > 0 {
		fmt.Printf("🏢 处理指定企业ID: %d\n", eid)
	} else {
		fmt.Printf("🏢 处理所有企业\n")
	}

	// 初始化数据库
	model.InitDB()

	// 初始化ES（如果需要）
	err := elasticsearch.InitGlobalClient()
	if err != nil {
		log.Printf("初始化ES失败: %v", err)
	}

	esClient := elasticsearch.GetGlobalClient()
	esAvailable := esClient != nil && !esClient.IsDisabled()
	if esAvailable {
		fmt.Println("✅ ES可用，将同步更新ES索引")
	} else {
		fmt.Println("⚠️ ES不可用，只更新数据库")
	}

	// 步骤1：检查并添加user_id字段
	fmt.Println("\n📋 步骤1: 检查File表结构...")
	if err := model.AddUserIDToFileTable(); err != nil {
		log.Fatalf("添加user_id字段失败: %v", err)
	}
	fmt.Println("✅ user_id字段检查完成")

	// 获取要处理的企业列表
	var enterprises []int64
	if eid > 0 {
		enterprises = []int64{eid}
	} else {
		var err error
		enterprises, err = getAllEnterprises()
		if err != nil {
			log.Fatalf("获取企业列表失败: %v", err)
		}
		fmt.Printf("📊 找到 %d 个企业\n", len(enterprises))
	}

	// 统计数据
	var totalAllFiles, totalUpdatedFiles, totalIndexedFiles int64

	// 处理每个企业
	for idx, currentEid := range enterprises {
		fmt.Printf("\n🏢 处理企业 %d/%d (ID: %d)\n", idx+1, len(enterprises), currentEid)

		// 步骤2：获取管理员用户列表
		fmt.Println("👥 查询管理员用户...")
		adminUsers, err := getAdminUsers(currentEid)
		if err != nil {
			log.Printf("查询企业 %d 管理员用户失败: %v", currentEid, err)
			continue
		}
		if len(adminUsers) == 0 {
			log.Printf("企业 %d 没有找到管理员用户，跳过", currentEid)
			continue
		}
		fmt.Printf("✅ 找到 %d 个管理员用户\n", len(adminUsers))
		for i, user := range adminUsers {
			fmt.Printf("   %d. %s (ID: %d, Role: %d)\n", i+1, user.Username, user.UserID, user.Role)
		}

		// 步骤3：更新文件的创建人
		fmt.Println("🔄 更新文件创建人...")
		totalFiles, updatedFiles, err := updateFileCreators(currentEid, adminUsers)
		if err != nil {
			log.Printf("更新企业 %d 文件创建人失败: %v", currentEid, err)
			continue
		}
		fmt.Printf("✅ 企业 %d 文件更新完成: 总计 %d 个文件，更新了 %d 个文件\n", currentEid, totalFiles, updatedFiles)

		totalAllFiles += totalFiles
		totalUpdatedFiles += updatedFiles

		// 步骤4：重新索引到ES
		if esAvailable {
			fmt.Println("📤 重新索引到ES...")
			indexedFiles, err := reindexFilesToES(currentEid)
			if err != nil {
				log.Printf("企业 %d 重新索引到ES失败: %v", currentEid, err)
			} else {
				fmt.Printf("✅ 企业 %d ES索引完成: 索引了 %d 个文件\n", currentEid, indexedFiles)
				totalIndexedFiles += indexedFiles
			}
		}
	}

	fmt.Println("\n🎉 所有任务完成!")
	fmt.Printf("📊 总体统计:\n")
	fmt.Printf("   - 处理企业: %d 个\n", len(enterprises))
	fmt.Printf("   - 文件总数: %d 个\n", totalAllFiles)
	fmt.Printf("   - 更新文件: %d 个\n", totalUpdatedFiles)
	if esAvailable {
		fmt.Printf("   - ES索引: %d 个\n", totalIndexedFiles)
	}
}

// getAdminUsers 获取企业管理员用户列表，优先返回RoleCreatorUser
func getAdminUsers(eid int64) ([]model.User, error) {
	var users []model.User

	// 首先查找RoleCreatorUser
	err := model.DB.Where("eid = ? AND status = ? AND role = ?",
		eid, model.UserStatusJoined, model.RoleCreatorUser).Find(&users).Error
	if err != nil {
		return nil, err
	}

	// 如果没有找到创建者，再查找其他管理员
	if len(users) == 0 {
		err = model.DB.Where("eid = ? AND status = ? AND role IN ?",
			eid, model.UserStatusJoined, []int64{
				model.RoleAdminUser, // 10 - 管理员
				model.RoleRootUser,  // 100000 - 超级管理员
			}).Find(&users).Error
		if err != nil {
			return nil, err
		}
	}

	// 如果还是没有找到，查找任何已加入的用户
	if len(users) == 0 {
		err = model.DB.Where("eid = ? AND status = ?", eid, model.UserStatusJoined).Find(&users).Error
		if err != nil {
			return nil, err
		}
	}

	return users, nil
}

// getAllEnterprises 获取所有企业ID列表
func getAllEnterprises() ([]int64, error) {
	var enterprises []struct {
		Eid int64
	}
	err := model.DB.Table("enterprises").Select("eid").Find(&enterprises).Error
	if err != nil {
		return nil, err
	}

	var eids []int64
	for _, enterprise := range enterprises {
		eids = append(eids, enterprise.Eid)
	}

	return eids, nil
}

// updateFileCreators 更新文件的创建人
func updateFileCreators(eid int64, adminUsers []model.User) (int64, int64, error) {
	// 统计总文件数
	var totalFiles int64
	err := model.DB.Model(&model.File{}).Where("eid = ? AND is_deleted = ?", eid, false).Count(&totalFiles).Error
	if err != nil {
		return 0, 0, err
	}

	// 查询没有user_id或user_id=0的文件
	var files []model.File
	err = model.DB.Where("eid = ? AND is_deleted = ? AND (user_id = 0 OR user_id IS NULL)", eid, false).Find(&files).Error
	if err != nil {
		return 0, 0, err
	}

	if len(files) == 0 {
		return totalFiles, 0, nil
	}

	// 初始化随机数生成器
	rand.Seed(time.Now().UnixNano())

	// 批量更新
	updatedCount := int64(0)
	batchSize := 100

	for i := 0; i < len(files); i += batchSize {
		end := i + batchSize
		if end > len(files) {
			end = len(files)
		}

		batch := files[i:end]

		// 开始事务
		tx := model.DB.Begin()
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		for _, file := range batch {
			// 随机选择一个管理员
			adminUser := adminUsers[rand.Intn(len(adminUsers))]

			// 更新文件
			result := tx.Model(&model.File{}).
				Where("id = ?", file.ID).
				Update("user_id", adminUser.UserID)

			if result.Error != nil {
				tx.Rollback()
				return totalFiles, updatedCount, fmt.Errorf("更新文件 %d 失败: %v", file.ID, result.Error)
			}

			if result.RowsAffected > 0 {
				updatedCount++
			}
		}

		// 提交事务
		if err := tx.Commit().Error; err != nil {
			return totalFiles, updatedCount, fmt.Errorf("提交事务失败: %v", err)
		}

		fmt.Printf("   已处理批次 %d/%d (更新了 %d 个文件)\n",
			(end / batchSize), (len(files)+batchSize-1)/batchSize, end-i)
	}

	return totalFiles, updatedCount, nil
}

// reindexFilesToES 重新索引文件到ES
func reindexFilesToES(eid int64) (int64, error) {
	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		return 0, fmt.Errorf("ES不可用")
	}

	// 创建文件搜索服务
	searchService := elasticsearch.NewFileNameSearchService(esClient, model.DB)

	// 分批处理文件
	batchSize := 100
	offset := 0
	totalIndexed := int64(0)

	for {
		// 查询文件
		var files []model.File
		err := model.DB.Where("eid = ? AND is_deleted = ? AND type = ?",
			eid, false, model.FILE_TYPE_FILE).
			Offset(offset).Limit(batchSize).Find(&files).Error
		if err != nil {
			return totalIndexed, err
		}

		if len(files) == 0 {
			break
		}

		// 批量索引到ES
		err = searchService.IndexFilesBatch(files)
		if err != nil {
			return totalIndexed, fmt.Errorf("批量索引失败: %v", err)
		}

		totalIndexed += int64(len(files))
		offset += batchSize

		fmt.Printf("   已索引 %d 个文件...\n", totalIndexed)
	}

	// 刷新索引
	indexManager := elasticsearch.NewIndexManager(esClient)
	if err := indexManager.RefreshIndex(); err != nil {
		log.Printf("刷新索引失败: %v", err)
	}

	return totalIndexed, nil
}
