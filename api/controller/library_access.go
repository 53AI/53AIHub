package controller

import (
	"context"
	"errors"
	"net/http"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

func requireLibraryPermission(c *gin.Context, eid int64, userID int64, libraryID int64, minPermission int, deniedMessage string, ctxs ...context.Context) (*model.Library, bool) {
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID, ctxs...)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}

	return library, true
}

func requireFilePermission(c *gin.Context, eid int64, userID int64, fileID int64, minPermission int, deniedMessage string) (*model.File, bool) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}

	return file, true
}

// filterFilesByPermission 按实测文件权限过滤列表：无查看权限的丢弃，有权限的回填 Permission；
// 有权限节点的祖先文件夹即使自身无权限也保留（骨架节点，只撑树渲染，Permission 保持实测值 0，
// 点开仍走 children 接口二次过滤，不泄漏内容）。只保留同列表内的祖先，不额外查库。
// 读权限走 service.BatchGetUserPermissions（用户行/群组/权限三级缓存 + ctx 全链路 request_id）。
func filterFilesByPermission(ctx context.Context, eid int64, userID int64, files []model.File) ([]model.File, error) {
	if len(files) == 0 {
		return files, nil
	}
	fileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		if f.ID > 0 {
			fileIDs = append(fileIDs, f.ID)
		}
	}
	if len(fileIDs) == 0 {
		return files, nil
	}

	permissions, err := service.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID, ctx)
	if err != nil {
		return nil, err
	}

	kept := make([]bool, len(files))
	pathIndex := make(map[string]int, len(files))
	for i := range files {
		files[i].Permission = permissions[files[i].ID]
		if files[i].Path != "" {
			pathIndex[files[i].Path] = i
		}
		if files[i].Permission >= model.PERMISSION_VIEW_ONLY {
			kept[i] = true
		}
	}
	for i := range files {
		if !kept[i] || files[i].Path == "" {
			continue
		}
		for p := parentFilePath(files[i].Path); p != ""; p = parentFilePath(p) {
			if idx, ok := pathIndex[p]; ok {
				kept[idx] = true
			}
		}
	}

	filtered := make([]model.File, 0, len(files))
	for i := range files {
		if kept[i] {
			filtered = append(filtered, files[i])
		}
	}
	return filtered, nil
}

// parentFilePath 取文件路径的父目录，"/A/b.md"→"/A"；根或空返回 "" 结束上溯。
func parentFilePath(p string) string {
	p = strings.TrimSuffix(p, "/")
	if p == "" || p == "/" {
		return ""
	}
	parent := path.Dir(p)
	if parent == "." || parent == "/" {
		return ""
	}
	return parent
}

func requireWikiPageSlugPermission(c *gin.Context, eid int64, userID int64, libraryID int64, slug string, minPermission int, deniedMessage string) (*model.WikiPage, bool) {
	page, err := model.GetWikiPageBySlug(eid, libraryID, slug)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, page.ID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}

	return page, true
}

func resolveWikiPageByID(c *gin.Context, eid int64, userID int64, minPermission int, deniedMessage string) (*model.WikiPage, bool) {
	pageID, err := parseWikiPageID(c.Param("page_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的页面ID")))
		return nil, false
	}
	page, err := model.GetWikiPageByID(eid, pageID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}
	return page, true
}

func requireChunkPermission(c *gin.Context, eid int64, userID int64, chunkID int64, minPermission int, deniedMessage string) (*model.DocumentChunk, *model.File, bool) {
	chunk, err := model.GetDocumentChunkByID(eid, chunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("分块不存在")))
		return nil, nil, false
	}

	file, ok := requireFilePermission(c, eid, userID, chunk.FileID, minPermission, deniedMessage)
	if !ok {
		return nil, nil, false
	}

	return chunk, file, true
}

func requireRetrievalChunkPermission(c *gin.Context, eid int64, userID int64, retrievalChunkID int64, minPermission int, deniedMessage string) (*model.RetrievalChunk, *model.File, bool) {
	retrievalChunk, err := model.GetRetrievalChunkByID(eid, retrievalChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("检索块不存在")))
		return nil, nil, false
	}

	file, ok := requireFilePermission(c, eid, userID, retrievalChunk.FileID, minPermission, deniedMessage)
	if !ok {
		return nil, nil, false
	}

	return retrievalChunk, file, true
}

func requireChunksPermission(c *gin.Context, eid int64, userID int64, chunkIDs []int64, minPermission int, deniedMessage string) bool {
	if len(chunkIDs) == 0 {
		return true
	}
	fileIDs := make(map[int64]struct{})
	for _, chunkID := range chunkIDs {
		chunk, err := model.GetDocumentChunkByID(eid, chunkID)
		if err != nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("分块不存在")))
			return false
		}
		fileIDs[chunk.FileID] = struct{}{}
	}
	for fileID := range fileIDs {
		if _, ok := requireFilePermission(c, eid, userID, fileID, minPermission, deniedMessage); !ok {
			return false
		}
	}
	return true
}

// requireWikiSpacePermission Wiki 空间级门禁：Wiki 空间权限（resource_type=4）已配置以其为准，
// 未配置回退 RAG 空间权限（resource_type=0）。与 Wiki 页面继承（resolveWikiPagePermissionFromData）
// 同口径——否则只配了 type=4、未配 type=0 的用户会在空间级门禁被 403，type=4 形同虚设。
func requireWikiSpacePermission(c *gin.Context, eid int64, userID int64, spaceID int64, minPermission int, deniedMessage string) bool {
	permission, err := common.GetWikiSpaceReadPermission(eid, spaceID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return false
	}
	return true
}
