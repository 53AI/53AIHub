package controller

import (
	"fmt"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// LogSpaceOperation 记录空间操作日志
func LogSpaceOperation(c *gin.Context, action uint8, spaceName, content string) {
	userID := config.GetUserId(c)
	eid := config.GetEID(c)
	
	systemLog := &model.SystemLog{
		Module:   model.SystemLogModuleSpace,
		Action:   action,
		UserID:   userID,
		Nickname: config.GetUserNickname(c),
		IP:       c.ClientIP(),
		Content:  content,
		Eid:      eid,
	}
	model.CreateSystemLog(systemLog)
}

// LogLibraryOperation 记录知识库操作日志
func LogLibraryOperation(c *gin.Context, action uint8, libraryName, content string) {
	userID := config.GetUserId(c)
	eid := config.GetEID(c)
	
	systemLog := &model.SystemLog{
		Module:   model.SystemLogModuleLibrary,
		Action:   action,
		UserID:   userID,
		Nickname: config.GetUserNickname(c),
		IP:       c.ClientIP(),
		Content:  content,
		Eid:      eid,
	}
	model.CreateSystemLog(systemLog)
}

// GetSpaceRoleText 获取空间角色文本
func GetSpaceRoleText(role int) string {
	roleText := map[int]string{
		model.SPACE_ROLE_MEMBER: "成员",
		model.SPACE_ROLE_ADMIN:  "管理员",
		model.SPACE_ROLE_OWNER:  "拥有者",
	}
	if text, exists := roleText[role]; exists {
		return text
	}
	return "未知角色"
}

// GetLibraryPermissionText 获取知识库权限文本
func GetLibraryPermissionText(permission int) string {
	permissionText := map[int]string{
		model.LIBRARY_PERMISSION_READ:  "只读",
		model.LIBRARY_PERMISSION_WRITE: "读写",
		model.LIBRARY_PERMISSION_ADMIN: "管理员",
	}
	if text, exists := permissionText[permission]; exists {
		return text
	}
	return "未知权限"
}

// LogSpaceCreate 记录空间创建日志
func LogSpaceCreate(c *gin.Context, spaceName string) {
	content := fmt.Sprintf("创建空间【%s】", spaceName)
	LogSpaceOperation(c, model.SystemLogActionCreate, spaceName, content)
}

// LogSpaceDelete 记录空间删除日志
func LogSpaceDelete(c *gin.Context, spaceName string) {
	content := fmt.Sprintf("删除空间【%s】", spaceName)
	LogSpaceOperation(c, model.SystemLogActionDelete, spaceName, content)
}

// LogSpaceBatchSort 记录空间批量排序日志
func LogSpaceBatchSort(c *gin.Context, count int) {
	content := fmt.Sprintf("批量更新空间排序，共更新 %d 个空间", count)
	LogSpaceOperation(c, model.SystemLogActionUpdate, "", content)
}

// LogSpaceMemberAdd 记录空间成员添加日志
func LogSpaceMemberAdd(c *gin.Context, spaceName, userNickname string, role int) {
	content := fmt.Sprintf("为空间【%s】添加成员【%s】，角色为【%s】", spaceName, userNickname, GetSpaceRoleText(role))
	LogSpaceOperation(c, model.SystemLogActionCreate, spaceName, content)
}

// LogSpaceMemberRoleUpdate 记录空间成员角色更新日志
func LogSpaceMemberRoleUpdate(c *gin.Context, spaceName, userNickname string, oldRole, newRole int) {
	content := fmt.Sprintf("修改空间【%s】成员【%s】的角色：从【%s】改为【%s】", 
		spaceName, userNickname, GetSpaceRoleText(oldRole), GetSpaceRoleText(newRole))
	LogSpaceOperation(c, model.SystemLogActionUpdate, spaceName, content)
}

// LogSpaceMemberRemove 记录空间成员移除日志
func LogSpaceMemberRemove(c *gin.Context, spaceName, userNickname string) {
	content := fmt.Sprintf("从空间【%s】移除成员【%s】", spaceName, userNickname)
	LogSpaceOperation(c, model.SystemLogActionDelete, spaceName, content)
}

// LogLibraryCreate 记录知识库创建日志
func LogLibraryCreate(c *gin.Context, spaceName, libraryName string) {
	content := fmt.Sprintf("在空间【%s】中创建知识库【%s】", spaceName, libraryName)
	LogLibraryOperation(c, model.SystemLogActionCreate, libraryName, content)
}

// LogLibraryDelete 记录知识库删除日志
func LogLibraryDelete(c *gin.Context, spaceName, libraryName string) {
	var content string
	if spaceName != "" {
		content = fmt.Sprintf("删除空间【%s】中的知识库【%s】", spaceName, libraryName)
	} else {
		content = fmt.Sprintf("删除知识库【%s】", libraryName)
	}
	LogLibraryOperation(c, model.SystemLogActionDelete, libraryName, content)
}

// LogLibraryBatchSort 记录知识库批量排序日志
func LogLibraryBatchSort(c *gin.Context, count int) {
	content := fmt.Sprintf("批量更新知识库排序，共更新 %d 个知识库", count)
	LogLibraryOperation(c, model.SystemLogActionUpdate, "", content)
}

// LogLibraryMemberAdd 记录知识库成员添加日志
func LogLibraryMemberAdd(c *gin.Context, libraryName, userNickname string, permission int) {
	content := fmt.Sprintf("为知识库【%s】添加成员【%s】，权限为【%s】", libraryName, userNickname, GetLibraryPermissionText(permission))
	LogLibraryOperation(c, model.SystemLogActionCreate, libraryName, content)
}

// LogLibraryMemberPermissionUpdate 记录知识库成员权限更新日志
func LogLibraryMemberPermissionUpdate(c *gin.Context, libraryName, userNickname string, oldPermission, newPermission int) {
	content := fmt.Sprintf("修改知识库【%s】成员【%s】的权限：从【%s】改为【%s】", 
		libraryName, userNickname, GetLibraryPermissionText(oldPermission), GetLibraryPermissionText(newPermission))
	LogLibraryOperation(c, model.SystemLogActionUpdate, libraryName, content)
}

// LogLibraryMemberRemove 记录知识库成员移除日志
func LogLibraryMemberRemove(c *gin.Context, libraryName, userNickname string) {
	content := fmt.Sprintf("从知识库【%s】移除成员【%s】", libraryName, userNickname)
	LogLibraryOperation(c, model.SystemLogActionDelete, libraryName, content)
}
