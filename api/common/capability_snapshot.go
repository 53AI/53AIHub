package common

import (
	"context"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// HasEditCorpusScopeFromSnapshots 用按库快照计算编辑语料权限。
// 计算逻辑与 resolveFilePermission（permission_resolver.go:529）逐行对齐：
//   - 近级优先：链上离文件最近的有匹配行一级直接定局（user/group/libuser/company 只在同级内按序取其一）；
//   - 任一候选文件 >= EDIT_ALL 即 true；已删除目标文件跳过（已删除父目录仍在链上参与继承）；
//   - 链上无任何匹配行走 resolveLibraryPermission 库级 fallback。
func HasEditCorpusScopeFromSnapshots(ctx context.Context, eid int64, libraryID int64, userID int64, tree *model.CapabilityFiletree, perms *model.CapabilityLibraryPerms) (bool, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctx)
	if err != nil {
		return false, err
	}
	return resolver.hasEditCorpusScopeFromSnapshots(ctx, eid, libraryID, tree, perms)
}

// capabilityViaName 把权限来源翻译成中文：日志第一眼可读，禁止裸露英文码。
func capabilityViaName(via string) string {
	switch via {
	case "user":
		return "用户直接授权"
	case "group":
		return "群组授权"
	case "library_role":
		return "库成员授权"
	case "company":
		return "全公司授权"
	default:
		return "库级兜底授权"
	}
}

// capabilityPermName 把权限值翻译成中文。
func capabilityPermName(perm int) string {
	switch {
	case perm >= model.PERMISSION_MANAGE:
		return "管理"
	case perm >= model.PERMISSION_EDIT_ALL:
		return "可编辑语料"
	case perm >= model.PERMISSION_EDIT_KNOWLEDGE:
		return "可编辑知识"
	case perm >= model.PERMISSION_VIEW_ONLY:
		return "只读"
	default:
		return "无权限"
	}
}

func (r *permissionResolver) hasEditCorpusScopeFromSnapshots(ctx context.Context, eid int64, libraryID int64, tree *model.CapabilityFiletree, perms *model.CapabilityLibraryPerms) (bool, error) {
	// 与 resolveFilePermission:534 对齐：注册用户直接 NONE。
	if r.user.Type == model.UserTypeRegistered {
		return false, nil
	}
	if tree == nil || perms == nil {
		return false, nil
	}
	lib, err := r.loadLibrary(libraryID)
	if err != nil {
		return false, err
	}
	if lib == nil {
		// 与 HasEditCorpusScope:14 的 GetLibraryByID 语义对齐：库不存在返回 RecordNotFound（控制器转 404）。
		return false, gorm.ErrRecordNotFound
	}

	// path -> 节点索引：替代 splitPathLevels + GetFilesByPathsAndLibrary 的 DB 匹配。
	byPath := make(map[string]*model.CapabilityFileNode, len(tree.Files))
	for i := range tree.Files {
		byPath[tree.Files[i].Path] = &tree.Files[i]
	}
	// 权限行按资源分组：替代 GetResourcesPermissions 的按文件查询。
	filePermsByID := make(map[int64][]model.CapabilityPermRow, len(perms.FilePerms))
	for _, row := range perms.FilePerms {
		filePermsByID[row.ResourceID] = append(filePermsByID[row.ResourceID], row)
	}

	// 库级 fallback 只算一次：同一库下所有文件共享（resolveLibraryPermission 请求内已有 memo）。
	libraryFallback := -1
	libraryFallbackComputed := false
	getLibraryFallback := func() (int, error) {
		if !libraryFallbackComputed {
			libraryFallbackComputed = true
			p, err := r.resolveLibraryPermission(libraryID)
			if err != nil {
				return 0, err
			}
			libraryFallback = p
		}
		return libraryFallback, nil
	}

	activeFiles := 0
	for i := range tree.Files {
		file := &tree.Files[i]
		// 与 HasEditCorpusScope:23 对齐：已删除跳过。
		if file.IsDeleted || file.IsActiveDeleted {
			continue
		}
		activeFiles++
		// 链推导：与 loadFileChain + resolveFilePermission:539-565 对齐。
		// DB 行的父链自底向上 [self...root]；此处 chainFiles 自顶向下构造后反向遍历，等价。
		levels := splitCapabilityPathLevels(file.Path)
		chainFiles := make([]*model.CapabilityFileNode, 0, len(levels))
		for _, levelPath := range levels {
			if node, ok := byPath[levelPath]; ok {
				chainFiles = append(chainFiles, node)
			}
		}
		// 快照缺行（库行/中间目录无 File 记录）：与 562-564 对齐，走库级 fallback。
		foundInTree := false
		for _, n := range chainFiles {
			if n.ID == file.ID {
				foundInTree = true
				break
			}
		}
		if !foundInTree {
			fb, err := getLibraryFallback()
			if err != nil {
				return false, err
			}
			if fb >= model.PERMISSION_EDIT_ALL {
				logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：有（库级兜底授权，权限%d（%s），文件%s）",
					r.userID, eid, libraryID, fb, capabilityPermName(fb), file.Path)
				return true, nil
			}
			continue
		}
		// 与 563-630 逐行对齐：level 越小（离文件越近）越赢；同级内 user(1) > group(2) > library_user(3) > company(4)。
		// 注意：不是全局 user 优先——近级的 company 会压过远级的 user；library_user 无需库 MANAGE 门槛，直接取值。
		matched := false
		for idx := len(chainFiles) - 1; idx >= 0 && !matched; idx-- {
			chainNode := chainFiles[idx]
			rows := filePermsByID[chainNode.ID]
			var currentUserPermission *int
			var currentGroupPermission *int
			var currentLibraryUserPermission *int
			var currentCompanyPermission *int
			for _, row := range rows {
				if row.SubjectType == model.SUBJECT_TYPE_USER && row.SubjectID == r.userID && currentUserPermission == nil {
					value := row.Permission
					currentUserPermission = &value
				} else if len(r.groupIDs) > 0 && row.SubjectType == model.SUBJECT_TYPE_GROUP &&
					helper.Int64InArray(row.SubjectID, r.groupIDs) {
					if currentGroupPermission == nil || row.Permission > *currentGroupPermission {
						value := row.Permission
						currentGroupPermission = &value
					}
				} else if row.SubjectType == model.SUBJECT_TYPE_LIBRARY_USER && currentLibraryUserPermission == nil {
					value := row.Permission
					currentLibraryUserPermission = &value
				} else if row.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL && currentCompanyPermission == nil {
					value := row.Permission
					currentCompanyPermission = &value
				}
			}
			var decidedPerm int
			var decidedVia string
			switch {
			case currentUserPermission != nil:
				decidedPerm, decidedVia = *currentUserPermission, "user"
			case currentGroupPermission != nil:
				decidedPerm, decidedVia = *currentGroupPermission, "group"
			case currentLibraryUserPermission != nil:
				decidedPerm, decidedVia = *currentLibraryUserPermission, "library_role"
			case currentCompanyPermission != nil:
				decidedPerm, decidedVia = *currentCompanyPermission, "company"
			default:
				continue
			}
			matched = true
			if decidedPerm >= model.PERMISSION_EDIT_ALL {
				logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：有（%s，权限%d（%s），命中路径%s，文件%s）",
					r.userID, eid, libraryID, capabilityViaName(decidedVia), decidedPerm, capabilityPermName(decidedPerm), chainNode.Path, file.Path)
				return true, nil
			}
		}
		if !matched {
			// 与 554-561、632-637 对齐：链上无任何匹配行走库级 fallback。
			fb, err := getLibraryFallback()
			if err != nil {
				return false, err
			}
			if fb >= model.PERMISSION_EDIT_ALL {
				logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：有（库级兜底授权，权限%d（%s），文件%s）",
					r.userID, eid, libraryID, fb, capabilityPermName(fb), file.Path)
				return true, nil
			}
		}
	}
	if activeFiles == 0 {
		// 空库兜底：库下没有任何有效文件时，文件级权限无从谈起，库级权限直接决定。
		// 与 resolveFilePermission 的库级 fallback 语义一致（链上无匹配行走库级权限）；
		// 创建人/库级 MANAGE 持有人在空库上同样可管理语料（可上传新文件），不能返回 false 挡住语料 Tab。
		fb, err := getLibraryFallback()
		if err != nil {
			return false, err
		}
		if fb >= model.PERMISSION_EDIT_ALL {
			logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：有（空库，库级授权，权限%d（%s））",
				r.userID, eid, libraryID, fb, capabilityPermName(fb))
			return true, nil
		}
		logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：无（空库，库级权限%d（%s）不足）",
			r.userID, eid, libraryID, fb, capabilityPermName(fb))
		return false, nil
	}
	logger.Infof(ctx, "【语料权限】用户%d（企业%d）请求知识库%d的语料编辑权限：无（共查%d个文件，均未达到编辑权限）",
		r.userID, eid, libraryID, len(tree.Files))
	return false, nil
}

// splitCapabilityPathLevels 与 model.splitPathLevels 等价（model/file.go:1060）：
// "/A/a.md" -> ["/A" "/A/a.md"]，根文件 "file.md" -> ["file.md"]。
// 路径统一用 path 包处理：与 ResolveUniqueFilePath 构造的正斜杠形式一致。
func splitCapabilityPathLevels(filePath string) []string {
	var levels []string
	if !strings.HasPrefix(filePath, "/") {
		levels = append(levels, filePath)
		return levels
	}
	parts := strings.Split(strings.Trim(filePath, "/"), "/")
	current := ""
	for _, part := range parts {
		if current == "" {
			current = "/" + part
		} else {
			current = path.Join(current, part)
		}
		levels = append(levels, current)
	}
	return levels
}
