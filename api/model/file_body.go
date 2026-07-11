package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"path"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils"
	"gorm.io/gorm"
)

const fileBodyContentPreviewLimit = 500

type OffsetParams struct {
	Offset int `form:"offset" binding:"omitempty"`
	Limit  int `form:"limit" binding:"omitempty"`
}

type FileBody struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	FileID      int64  `json:"file_id" gorm:"not null;index"`
	LibraryID   int64  `json:"library_id" gorm:"not null;index"`
	Eid         int64  `json:"eid" gorm:"not null;index"`
	Content     string `json:"content" gorm:"not null;type:text"`
	ContentPath string `json:"content_path" gorm:"type:varchar(512);index"`
	UserID      int64  `json:"user_id" gorm:"not null;index;comment:'修改人用户ID'"`
	BaseModel

	// 关联字段，用于 Preload (一对多关系)
	FileBodyVersions []*FileBodyVersion `json:"file_body_versions,omitempty"`
	User             *User              `json:"user,omitempty" gorm:"-"`
}

func NewFileBody(eid, fileID, libraryID, userID int64, content string) *FileBody {
	return &FileBody{
		FileID:    fileID,
		LibraryID: libraryID,
		Eid:       eid,
		Content:   content,
		UserID:    userID,
	}
}

func (fb *FileBody) BeforeSave(tx *gorm.DB) error {
	return fb.ProcessContentStorage()
}

func (fb *FileBody) Save() error {
	fullContent := fb.Content
	// 如果需要存储，先执行存储处理
	if err := fb.ProcessContentStorage(); err != nil {
		return err
	}
	// 如果内容被截断（说明执行了存储），需要确保 fullContent 是完整的
	// ProcessContentStorage 只有在存储了内容时才会截断 content
	// 如果 content 本来就是预览（且有 path），ProcessContentStorage 不会改变它，但 fullContent 也是预览
	// 这是一个问题：Save() 需要完整的 content 来统计字符数
	// 如果 content 已经是预览，我们可能需要加载完整内容？
	// 或者，Save() 总是假设 fb.Content 在调用前是完整的？
	// 既然 Save() 是创建新记录，通常 fb.Content 是完整的。

	// 如果 ProcessContentStorage 截断了 fb.Content，fullContent 仍然保留原始值
	// 如果 fb.Content 已经是预览（path存在），ProcessContentStorage 不做任何事
	// 此时 fullContent = 预览。
	// 如果我们需要准确统计字符数，我们可能需要加载。
	if fb.ContentPath != "" && runeLength(fullContent) <= fileBodyContentPreviewLimit {
		// 尝试加载完整内容
		if data, err := storage.StorageInstance.Load(fb.ContentPath); err == nil {
			fullContent = string(data)
		}
	}

	result := DB.Create(fb)
	if result.Error != nil {
		return result.Error
	}

	// 同步更新关联的文件的字符数统计
	go func() {
		characterCount := utils.CountCharacters(fullContent)
		if err := UpdateFileCharacterCount(fb.Eid, fb.FileID, characterCount); err != nil {
			// 记录错误但不影响主流程
			log.Printf("更新文件字符数统计失败: eid=%d, fileID=%d, err=%v", fb.Eid, fb.FileID, err)
		}
	}()

	return nil
}

// Update 更新文件内容
func (fb *FileBody) Update() error {
	fullContent := fb.Content
	if err := fb.ProcessContentStorage(); err != nil {
		return err
	}

	if fb.ContentPath != "" && runeLength(fullContent) <= fileBodyContentPreviewLimit {
		if data, err := storage.StorageInstance.Load(fb.ContentPath); err == nil {
			fullContent = string(data)
		}
	}

	result := DB.Model(fb).Updates(fb)
	if result.Error != nil {
		return result.Error
	}

	// 同步更新关联的文件的字符数统计
	go func() {
		characterCount := utils.CountCharacters(fullContent)
		if err := UpdateFileCharacterCount(fb.Eid, fb.FileID, characterCount); err != nil {
			// 记录错误但不影响主流程
			log.Printf("更新文件字符数统计失败: eid=%d, fileID=%d, err=%v", fb.Eid, fb.FileID, err)
		}
	}()

	return nil
}

// ReplaceContent 用新内容替换文件内容并写入新的 FileBody 记录。
func (fb *FileBody) ReplaceContent(content string) error {
	fb.Content = content
	return fb.Save()
}

// AppendContent 在现有内容后追加文本并更新当前 FileBody 记录。
func (fb *FileBody) AppendContent(content string) error {
	fb.Content = fb.Content + content
	return fb.Update()
}

func (fb *FileBody) LoadContent() error {
	if fb == nil {
		return nil
	}
	if fb.ContentPath == "" {
		fb.Content = strings.TrimPrefix(fb.Content, "\ufeff")
		return nil
	}
	data, err := storage.StorageInstance.Load(fb.ContentPath)
	if err != nil {
		return err
	}
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		data = data[3:]
	}
	fb.Content = string(data)
	fb.Content = strings.TrimPrefix(fb.Content, "\ufeff")
	return nil
}

func (fb *FileBody) GetContent() (string, error) {
	if err := fb.LoadContent(); err != nil {
		return "", err
	}
	if fb == nil {
		return "", nil
	}
	return strings.TrimPrefix(fb.Content, "\ufeff"), nil
}

// ProcessContentStorage 处理内容存储：将长内容保存到存储服务，并截断 Content 字段
// 此方法在 Save/Update 前调用
func (fb *FileBody) ProcessContentStorage() error {
	if fb == nil {
		return nil
	}
	if fb.Content == "" {
		return nil
	}

	// 如果已有路径且内容看起来是预览（短内容），则认为是已处理过的，跳过
	if fb.ContentPath != "" && runeLength(fb.Content) <= fileBodyContentPreviewLimit {
		return nil
	}

	// 内容需要存储
	fullContent := fb.Content
	key := buildFileBodyContentKey(fb.Eid, fullContent)

	// 检查存储中是否存在
	if !storage.StorageInstance.Exists(key) {
		if err := storage.StorageInstance.Save([]byte(fullContent), key); err != nil {
			return err
		}
	}

	fb.ContentPath = key
	fb.Content = truncateRunes(fullContent, fileBodyContentPreviewLimit)
	return nil
}

// storeContentIfNeeded 兼容旧代码，保留但不推荐使用
// 实际上新的 Save/Update 逻辑已经不再依赖它的"加载"功能，只依赖 ProcessContentStorage
func (fb *FileBody) storeContentIfNeeded() (string, error) {
	if err := fb.ProcessContentStorage(); err != nil {
		return "", err
	}
	// 为了兼容性，如果需要返回完整内容
	if fb.ContentPath != "" {
		data, err := storage.StorageInstance.Load(fb.ContentPath)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	return fb.Content, nil
}

func buildFileBodyContentKey(eid int64, content string) string {
	sum := sha256.Sum256([]byte(content))
	eidStr := strconv.FormatInt(eid, 10)
	return storage.StorageInstance.GetBasePath() + "/" + path.Join("file_bodies", eidStr, hex.EncodeToString(sum[:])+".md")
}

func truncateRunes(s string, limit int) string {
	if limit <= 0 || s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	return string(r[:limit])
}

func runeLength(s string) int {
	return len([]rune(s))
}

func CheckFileBodyContentMigrationNeeded() (bool, error) {
	var fb FileBody
	err := DB.Select("id").
		Where("(content_path = '' OR content_path IS NULL) AND LENGTH(content) > ?", fileBodyContentPreviewLimit).
		First(&fb).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}

func MigrateFileBodyContent(scope string, targetID int64, batchSize int) (int, error) {
	if batchSize <= 0 {
		batchSize = 100
	}

	migrated := 0
	for {
		var fileBodies []FileBody
		query := DB.Select("id", "eid", "content").
			Where("(content_path = '' OR content_path IS NULL) AND LENGTH(content) > ?", fileBodyContentPreviewLimit)

		if scope == "eid" {
			query = query.Where("eid = ?", targetID)
		} else if scope == "file_id" {
			query = query.Where("file_id = ?", targetID)
		}

		if err := query.Limit(batchSize).Find(&fileBodies).Error; err != nil {
			return migrated, err
		}
		if len(fileBodies) == 0 {
			return migrated, nil
		}

		for i := range fileBodies {
			fb := &fileBodies[i]
			fullContent := fb.Content
			if fullContent == "" {
				continue
			}

			key := buildFileBodyContentKey(fb.Eid, fullContent)
			if !storage.StorageInstance.Exists(key) {
				if err := storage.StorageInstance.Save([]byte(fullContent), key); err != nil {
					return migrated, err
				}
			}

			preview := truncateRunes(fullContent, fileBodyContentPreviewLimit)
			if err := DB.Model(&FileBody{}).Where("id = ?", fb.ID).Updates(map[string]interface{}{
				"content_path": key,
				"content":      preview,
			}).Error; err != nil {
				return migrated, err
			}
			migrated++
		}
	}
}

func MigrateFileBodyContentToStorage(batchSize int) (int, error) {
	return MigrateFileBodyContent("all", 0, batchSize)
}

func RollbackFileBodyContentFromStorage(batchSize int) (int, error) {
	if batchSize <= 0 {
		batchSize = 100
	}

	rolledBack := 0
	for {
		var fileBodies []FileBody
		if err := DB.Select("id", "content_path").
			Where("content_path <> '' AND content_path IS NOT NULL").
			Limit(batchSize).
			Find(&fileBodies).Error; err != nil {
			return rolledBack, err
		}
		if len(fileBodies) == 0 {
			return rolledBack, nil
		}

		for i := range fileBodies {
			fb := &fileBodies[i]
			data, err := storage.StorageInstance.Load(fb.ContentPath)
			if err != nil {
				return rolledBack, err
			}
			if err := DB.Model(&FileBody{}).Where("id = ?", fb.ID).Updates(map[string]interface{}{
				"content_path": "",
				"content":      string(data),
			}).Error; err != nil {
				return rolledBack, err
			}
			rolledBack++
		}
	}
}

func GetLastFileBodyByFileID(eid int64, fileID int64) (*FileBody, error) {
	var fileBody FileBody
	if err := DB.Where("eid = ? AND file_id = ?", eid, fileID).Order("created_time desc").First(&fileBody).Error; err != nil {
		return nil, err
	}
	return &fileBody, nil
}

func GetFileBodyByID(id int64) (*FileBody, error) {
	var fileBody FileBody
	if err := DB.Where("id = ?", id).First(&fileBody).Error; err != nil {
		return nil, err
	}
	return &fileBody, nil
}

// UpdateFileCharacterCount 直接更新指定文件的字符数统计
func UpdateFileCharacterCount(eid int64, fileID int64, characterCount int) error {
	// 更新文件的字符数统计
	result := DB.Model(&File{}).Where("eid = ? AND id = ?", eid, fileID).Update("character_count", characterCount)
	if result.Error != nil {
		return fmt.Errorf("更新文件字符数统计失败: %v", result.Error)
	}

	return nil
}
