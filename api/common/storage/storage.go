package storage

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

var StorageInstance Storage = NewStorage()

type Storage interface {
	Save(file []byte, fileName string) error
	SaveFile(srcPath string, fileName string) error
	SaveFromReader(r io.Reader, fileName string) error
	Exists(fileName string) bool
	Delete(fileName string) error
	Load(fileName string) ([]byte, error)
	GetBasePath() string
}

type LocalStorage struct {
	BasePath string
	mu       sync.RWMutex
}

type AliyunOSSStorage struct {
	client          *oss.Client
	bucket          *oss.Bucket
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	BucketName      string
	BasePath        string
}

// GetBucket returns the OSS bucket instance for advanced operations
func (a *AliyunOSSStorage) GetBucket() *oss.Bucket {
	return a.bucket
}

func NewStorage() Storage {
	storage, initMessage := newStorageFromConfig(
		config.StorageType,
		config.StorageBasePath,
		config.AliyunOssEndpoint,
		config.AliyunOssAccessKeyID,
		config.AliyunOssAccessKeySecret,
		config.AliyunOssBucketName,
	)
	logger.SysLogf("Storage init: %s", initMessage)
	return storage
}

func newStorageFromConfig(storageType, basePath, endpoint, accessKeyID, accessKeySecret, bucketName string) (Storage, string) {
	switch storageType {
	case "aliyun_oss":
		client, err := oss.New(endpoint, accessKeyID, accessKeySecret)
		if err != nil {
			// OSS 客户端创建失败，记录错误并降级到本地存储
			logger.SysWarnf("Failed to create OSS client: %v, falling back to local storage", err)
			return &LocalStorage{BasePath: basePath}, describeStorageInitMessage(storageType, "local", basePath, fmt.Sprintf("oss client init failed: %v", err))
		}
		bucket, err := client.Bucket(bucketName)
		if err != nil {
			// OSS 存储桶获取失败，记录错误并降级到本地存储
			logger.SysWarnf("Failed to get OSS bucket: %v, falling back to local storage", err)
			return &LocalStorage{BasePath: basePath}, describeStorageInitMessage(storageType, "local", basePath, fmt.Sprintf("oss bucket init failed: %v", err))
		}
		return &AliyunOSSStorage{
			client:          client,
			bucket:          bucket,
			Endpoint:        endpoint,
			AccessKeyID:     accessKeyID,
			AccessKeySecret: accessKeySecret,
			BucketName:      bucketName,
			BasePath:        basePath,
		}, describeStorageInitMessage(storageType, "aliyun_oss", basePath, fmt.Sprintf("endpoint=%s bucket=%s", endpoint, bucketName))
	default:
		return &LocalStorage{BasePath: basePath}, describeStorageInitMessage(storageType, "local", basePath, "default local storage")
	}
}

func describeStorageInitMessage(requestedType, backend, basePath, detail string) string {
	if detail == "" {
		detail = "no detail"
	}
	return fmt.Sprintf("requested=%s, backend=%s, base_path=%s, detail=%s", requestedType, backend, basePath, detail)
}

func (l *LocalStorage) Save(file []byte, fileName string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	fullPath := l.resolvePath(fileName)
	if err := os.MkdirAll(path.Dir(fullPath), 0755); err != nil {
		return fmt.Errorf("create dir error: %w", err)
	}

	if err := os.WriteFile(fullPath, file, 0666); err != nil {
		return fmt.Errorf("write file error: %w", err)
	}

	return nil
}

func (l *LocalStorage) SaveFile(srcPath string, fileName string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("open source file error: %w", err)
	}
	defer srcFile.Close()

	fullPath := l.resolvePath(fileName)
	if err := os.MkdirAll(path.Dir(fullPath), 0o755); err != nil {
		return fmt.Errorf("create dir error: %w", err)
	}

	dstFile, err := os.Create(fullPath)
	if err != nil {
		return fmt.Errorf("create file error: %w", err)
	}
	defer func() {
		_ = dstFile.Close()
	}()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("copy file error: %w", err)
	}
	if err := dstFile.Sync(); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("sync file error: %w", err)
	}
	return nil
}

func (l *LocalStorage) SaveFromReader(r io.Reader, fileName string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	fullPath := l.resolvePath(fileName)
	if err := os.MkdirAll(path.Dir(fullPath), 0755); err != nil {
		return fmt.Errorf("create dir error: %w", err)
	}

	dstFile, err := os.Create(fullPath)
	if err != nil {
		return fmt.Errorf("create file error: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, r); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("copy file error: %w", err)
	}
	if err := dstFile.Sync(); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("sync file error: %w", err)
	}
	return nil
}

func (l *LocalStorage) Exists(fileName string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	_, err := os.Stat(l.resolvePath(fileName))
	return !os.IsNotExist(err)
}

func (l *LocalStorage) Delete(fileName string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	err := os.Remove(l.resolvePath(fileName))
	if err != nil {
		return fmt.Errorf("remove file error: %w", err)
	}
	return nil
}

func (l *LocalStorage) Load(fileName string) ([]byte, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	data, err := os.ReadFile(l.resolvePath(fileName))
	if err != nil {
		return nil, fmt.Errorf("read file error: %w", err)
	}
	return data, nil
}

func GetFileHash(file multipart.File) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	if seeker, ok := file.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return "", fmt.Errorf("file seek error: %w", err)
		}
	}

	hashInBytes := hash.Sum(nil)
	return hex.EncodeToString(hashInBytes), nil
}

func (l *LocalStorage) GetBasePath() string {
	return l.BasePath
}

func (l *LocalStorage) resolvePath(fileName string) string {
	trimmed := strings.TrimSpace(fileName)
	if trimmed == "" {
		return trimmed
	}

	cleaned := filepath.Clean(trimmed)
	if filepath.IsAbs(cleaned) || strings.TrimSpace(l.BasePath) == "" {
		return cleaned
	}

	cleanBase := filepath.Clean(l.BasePath)
	sep := string(os.PathSeparator)
	if cleaned == cleanBase || strings.HasPrefix(cleaned, cleanBase+sep) {
		return cleaned
	}

	return filepath.Join(cleanBase, cleaned)
}

func (a *AliyunOSSStorage) Save(file []byte, fileName string) error {
	objectName := filepath.ToSlash(fileName)
	reader := bytes.NewReader(file)

	err := a.bucket.PutObject(objectName, reader)
	if err != nil {
		return fmt.Errorf("oss upload error: %w", err)
	}
	return nil
}

func (a *AliyunOSSStorage) SaveFile(srcPath string, fileName string) error {
	objectName := filepath.ToSlash(fileName)
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("open source file error: %w", err)
	}
	defer srcFile.Close()

	if err := a.bucket.PutObject(objectName, srcFile); err != nil {
		return fmt.Errorf("oss upload error: %w", err)
	}
	return nil
}

func (a *AliyunOSSStorage) SaveFromReader(r io.Reader, fileName string) error {
	objectName := filepath.ToSlash(fileName)
	if err := a.bucket.PutObject(objectName, r); err != nil {
		return fmt.Errorf("oss upload error: %w", err)
	}
	return nil
}

func (a *AliyunOSSStorage) Load(fileName string) ([]byte, error) {
	objectName := filepath.ToSlash(fileName)
	reader, err := a.bucket.GetObject(objectName)
	if err != nil {
		return nil, fmt.Errorf("oss file download error: %w", err)
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func (a *AliyunOSSStorage) Exists(fileName string) bool {
	objectName := filepath.ToSlash(fileName)
	exist, err := a.bucket.IsObjectExist(objectName)
	return err == nil && exist
}

func (a *AliyunOSSStorage) Delete(fileName string) error {
	objectName := filepath.ToSlash(fileName)
	if err := a.bucket.DeleteObject(objectName); err != nil {
		return fmt.Errorf("oss file delete error: %w", err)
	}
	return nil
}

func (a *AliyunOSSStorage) GetBasePath() string {
	return a.BasePath
}
