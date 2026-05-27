package config

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/gin-gonic/gin"
)

// 从VERSION文件读取版本号
func loadVersionFromFile() string {
	versionFile := "VERSION"

	// 尝试读取VERSION文件
	if _, err := os.Stat(versionFile); err == nil {
		// 文件存在，读取内容
		content, err := os.ReadFile(versionFile)
		if err == nil {
			return strings.TrimSpace(string(content))
		}
	}

	// 如果文件不存在或读取失败，返回默认版本号
	return "v1.0.0.20251229"
}

// Version 优先从编译时注入，其次环境变量，然后从VERSION文件读取，最后使用默认值
// 注意：系统版本信息可通过编译时 -ldflags -X 参数注入，格式如：-X 'config.Version=v1.0.0'
var Version string

func init() {
	// 优先级1: 编译时注入
	if Version != "" {
		return
	}

	// 优先级2: 环境变量覆盖
	envVersion := env.String("HUB_VERSION", "")
	if envVersion != "" {
		Version = envVersion
		return
	}

	// 优先级3: VERSION文件
	Version = loadVersionFromFile()
}

// build time make file
// go build -ldflags "-X 'config.VersionTime=$(date +%Y%m%d%H%M)'"
var VersionTime string
var Server = env.String("HUB_SERVER", "")
var SandboxServiceURL = env.String("SANDBOX_SERVICE_URL", "http://localhost:8000")
var SandboxRuntimeProvider = env.String("SANDBOX_RUNTIME_PROVIDER", "docker")
var SandboxRuntimeWorkspaceRoot = env.String("SANDBOX_RUNTIME_WORKSPACE_ROOT", filepath.Join(os.TempDir(), "53ai-sandbox"))
var SandboxRuntimeContainerPrefix = env.String("SANDBOX_RUNTIME_CONTAINER_PREFIX", "53ai-sbx-")
var SandboxRuntimeImage = env.String("SANDBOX_RUNTIME_IMAGE", "53ai-sandbox:latest")
var SandboxRuntimeContainerWorkdir = env.String("SANDBOX_RUNTIME_CONTAINER_WORKDIR", "/workspace")
var SandboxRuntimeTimeoutSeconds = env.Int("SANDBOX_RUNTIME_TIMEOUT_SECONDS", 300)
var SandboxRuntimeIdleCleanupSeconds = env.Int("SANDBOX_RUNTIME_IDLE_CLEANUP_SECONDS", 3600)
var SandboxRuntimeNetworkEnabled = env.Bool("SANDBOX_RUNTIME_NETWORK_ENABLED", true)
var SandboxRuntimeReadOnlyRoot = env.Bool("SANDBOX_RUNTIME_READ_ONLY_ROOT", false)

type RuntimeProviderConfig struct {
	Provider           string
	WorkspaceRoot      string
	ContainerPrefix    string
	Image              string
	ContainerWorkdir   string
	TimeoutSeconds     int
	IdleCleanupSeconds int
	NetworkEnabled     bool
	ReadOnlyRoot       bool
}

func RuntimeProviderConfigFromEnv() RuntimeProviderConfig {
	return RuntimeProviderConfig{
		Provider:           strings.TrimSpace(SandboxRuntimeProvider),
		WorkspaceRoot:      SandboxRuntimeWorkspaceRoot,
		ContainerPrefix:    SandboxRuntimeContainerPrefix,
		Image:              SandboxRuntimeImage,
		ContainerWorkdir:   SandboxRuntimeContainerWorkdir,
		TimeoutSeconds:     SandboxRuntimeTimeoutSeconds,
		IdleCleanupSeconds: SandboxRuntimeIdleCleanupSeconds,
		NetworkEnabled:     SandboxRuntimeNetworkEnabled,
		ReadOnlyRoot:       SandboxRuntimeReadOnlyRoot,
	}
}

var SandboxMode = normalizeSandboxMode(env.String("SANDBOX_MODE", "all"))
var SandboxScope = normalizeSandboxScope(env.String("SANDBOX_SCOPE", "session"))
var SandboxWorkspaceAccess = normalizeSandboxWorkspaceAccess(env.String("SANDBOX_WORKSPACE_ACCESS", "rw"))
var FileStoragePath = env.String("FILE_STORAGE_PATH", "./data/files") // 本地文件存储路径
var FileStorageURL = env.String("FILE_STORAGE_URL", "/api/files")     // 文件访问 URL 前缀
var LogDir = env.String("LOG_DIR", "")
var LOG_LEVEL = env.String("LOG_LEVEL", "info")
var FILE_LOG_VIEWER_ACCESS_TOKEN = env.String("FILE_LOG_VIEWER_ACCESS_TOKEN", "")
var DebugEnabled = env.Bool("DEBUG", false)
var OnlyOneLogFile = env.Bool("ONLY_ONE_LOG_FILE", false)
var StartTime = time.Now().Format("2006-01-02 15:04:05")
var IS_SAAS = env.Bool("IS_SAAS", false)
var ENTERPRISE_APPLY_AUTO_APPROVE = env.Bool("ENTERPRISE_APPLY_AUTO_APPROVE", true) // 默认自动批准企业申请
var ApiHost = env.String("API_HOST", "http://127.0.0.1:3000")
var SERVER_PORT = env.String("PORT", "3000")
var KKBaseURL = env.String("KK_BASE_URL", "")
var DocConvertBaseURL = env.String("DOC_CONVERT_BASE_URL", "")
var MigrateDBEnabled = env.Bool("MIGRATE_DB_ENABLED", true)
var SchemaMigrateAutoEnabled = env.Bool("SCHEMA_MIGRATE_AUTO_ENABLED", false)
var SchemaMigrateAutoDelaySeconds = env.Int("SCHEMA_MIGRATE_AUTO_DELAY_SECONDS", 180)
var SchemaMigrateGuardEnabled = env.Bool("SCHEMA_MIGRATE_GUARD_ENABLED", true)
var SchemaMigrateGuardMaxWaitSeconds = env.Int("SCHEMA_MIGRATE_GUARD_MAX_WAIT_SECONDS", 600)
var SchemaMigrateGuardPollSeconds = env.Int("SCHEMA_MIGRATE_GUARD_POLL_SECONDS", 10)

var ADMIN_EMAIL = env.String("ADMIN_EMAIL", "admin@53ai.com")
var ADMIN_MOBILE = env.String("ADMIN_MOBILE", "")
var ADMIN_PASSWORD = env.String("ADMIN_PASSWORD", "admin888")

var REDIS_CONN = env.String("REDIS_CONN", "")

// Redis连接池配置
var REDIS_POOL_SIZE = env.Int("REDIS_POOL_SIZE", 100)
var REDIS_MIN_IDLE_CONNS = env.Int("REDIS_MIN_IDLE_CONNS", 10)
var REDIS_MAX_RETRIES = env.Int("REDIS_MAX_RETRIES", 5)

// Redis超时配置（秒）
var REDIS_DIAL_TIMEOUT_SECONDS = env.Int("REDIS_DIAL_TIMEOUT_SECONDS", 10)
var REDIS_READ_TIMEOUT_SECONDS = env.Int("REDIS_READ_TIMEOUT_SECONDS", 5)
var REDIS_WRITE_TIMEOUT_SECONDS = env.Int("REDIS_WRITE_TIMEOUT_SECONDS", 5)
var REDIS_IDLE_TIMEOUT_MINUTES = env.Int("REDIS_IDLE_TIMEOUT_MINUTES", 10)
var REDIS_MAX_CONN_AGE_MINUTES = env.Int("REDIS_MAX_CONN_AGE_MINUTES", 30)

var MAX_UPLOAD_FILE_SIZE_STRING = env.String("MAX_UPLOAD_FILE_SIZE", "30MB")
var MAX_UPLOAD_FILE_SIZE, _ = helper.ParseSize(MAX_UPLOAD_FILE_SIZE_STRING)

var CHANNEL_RETRY_TIMES = env.Int64("CHANNEL_RETRY_TIMES", 3)
var EnforceIncludeUsage = env.Bool("ENFORCE_INCLUDE_USAGE", false)

var PreConsumedQuota int64 = 500
var WECOM_SUITE_ID = env.String("WECOM_SUITE_ID", "")
var IS_TEST_WECOM_SUITE = env.Bool("IS_TEST_WECOM_SUITE", false)
var HUAWEI_CLOUD_ACCESS_KEY = env.String("HUAWEI_CLOUD_ACCESS_KEY", "")
var DINGTALK_SUITE_ID = env.String("DINGTALK_SUITE_ID", "")

// SMS短信配置
var SMS_ENABLED = env.Bool("SMS_ENABLED", false)
var SMS_PROVIDER = env.String("SMS_PROVIDER", "")    // 短信提供商 (253chuanglan)
var SMS_ACCOUNT = env.String("SMS_ACCOUNT", "")      // 短信账户/用户名
var SMS_PASSWORD = env.String("SMS_PASSWORD", "")    // 短信密码
var SMS_SIGN_NAME = env.String("SMS_SIGN_NAME", "")  // 短信签名 (如【博思协创】)
var SMS_CODE_LENGTH = env.Int("SMS_CODE_LENGTH", 4)  // 验证码长度
var SMS_EXPIRY_TIME = env.Int("SMS_EXPIRY_TIME", 15) // 验证码有效期（分钟）

// 文档上传配置
var DOCUMENT_UPLOAD_MAX_CONCURRENT = env.Int("DOCUMENT_UPLOAD_MAX_CONCURRENT", 50)
var DOCUMENT_UPLOAD_CHUNK_SIZE = env.Int64("DOCUMENT_UPLOAD_CHUNK_SIZE", 5<<20)         // 5MB
var DOCUMENT_SINGLE_FILE_MAX_SIZE = env.Int64("DOCUMENT_SINGLE_FILE_MAX_SIZE", 500<<20) // 500MB

// 默认文档 URL 配置
var DEFAULT_DOC_URL = env.String("DEFAULT_DOC_URL", "https://oss.ibos.cn/53aikm/static/default/53AI%20KM%20%E7%9F%A5%E8%AF%86%E7%AE%A1%E7%90%86%E6%96%B9%E6%B3%95%E8%AE%BA%E4%B8%8E%E5%AE%9E%E8%B7%B5.md")

// 为了向后兼容，保留旧的配置名称作为别名
var BATCH_UPLOAD_MAX_CONCURRENT = DOCUMENT_UPLOAD_MAX_CONCURRENT
var BATCH_UPLOAD_CHUNK_SIZE = DOCUMENT_UPLOAD_CHUNK_SIZE
var BATCH_UPLOAD_MAX_FILE_SIZE = DOCUMENT_SINGLE_FILE_MAX_SIZE // 单文件上传限制

var RAG_JOB_ENGINE_WORKERS = env.Int("RAG_JOB_ENGINE_WORKERS", 5)
var RAG_JOB_ENGINE_MAX_RETRIES = env.Int("RAG_JOB_ENGINE_MAX_RETRIES", 0)
var RAG_JOB_PROCESS_DELAY_SECONDS = env.Int("RAG_JOB_PROCESS_DELAY_SECONDS", 0) // 任务处理间隔延迟（秒），0表示无延迟
var AGENT_MAX_TURNS = env.Int("AGENT_MAX_TURNS", 15)
var RAG_MULTI_LIBRARY_SEARCH_MAX_CONCURRENT = env.Int("RAG_MULTI_LIBRARY_SEARCH_MAX_CONCURRENT", 4)
var RAG_COLLECTION_SEARCH_MAX_CONCURRENT = env.Int("RAG_COLLECTION_SEARCH_MAX_CONCURRENT", 3)
var RAG_SEARCH_ENGINE_MAX_WORKERS = env.Int("RAG_SEARCH_ENGINE_MAX_WORKERS", 3)

var RECORDING_CHUNK_RETAIN_SECONDS = env.Int("RECORDING_CHUNK_RETAIN_SECONDS", 86400)
var RECORDING_LOCAL_ROOT = env.String("RECORDING_LOCAL_ROOT", "")
var RECORDING_INSTANCE_ID = env.String("RECORDING_INSTANCE_ID", "default")

var RECORDING_SPOOL_FLUSH_DURATION_MS = env.Int("RECORDING_SPOOL_FLUSH_DURATION_MS", 300000)

// Chunk 上传临时存储目录配置（避免多实例跨 tmp 目录互相影响）
var CHUNK_UPLOAD_TEMP_DIR = env.String("CHUNK_UPLOAD_TEMP_DIR", "")

// getAppDir 获取应用程序所在目录，用于基于可执行文件位置计算数据目录
func getAppDir() string {
	if execPath, err := os.Executable(); err == nil {
		return filepath.Dir(execPath)
	}
	// 回退到当前工作目录
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}

func GetRecordingInstanceID() string {
	instanceID := strings.TrimSpace(os.Getenv("RECORDING_INSTANCE_ID"))
	if instanceID != "" {
		return instanceID
	}
	return strings.TrimSpace(RECORDING_INSTANCE_ID)
}

func RecordingLocalRoot() string {
	root := strings.TrimSpace(os.Getenv("RECORDING_LOCAL_ROOT"))
	if root == "" {
		root = strings.TrimSpace(RECORDING_LOCAL_ROOT)
	}
	if root == "" {
		root = filepath.Join(getAppDir(), "data", "recordings")
	}
	if abs, err := filepath.Abs(root); err == nil {
		return abs
	}
	return filepath.Clean(root)
}

func RecordingAssemblySpoolRoot() string {
	return filepath.Join(RecordingLocalRoot(), "recording-spool")
}

func ChunkUploadTempDir() string {
	dir := strings.TrimSpace(os.Getenv("CHUNK_UPLOAD_TEMP_DIR"))
	if dir == "" {
		dir = strings.TrimSpace(CHUNK_UPLOAD_TEMP_DIR)
	}
	if dir == "" {
		dir = filepath.Join(getAppDir(), "data", "chunk-upload")
	}
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return filepath.Clean(dir)
}

const (
	SandboxModeOff     = "off"
	SandboxModeAll     = "all"
	SandboxModeNonMain = "non-main"
)

const (
	SSEStreamModeLegacy  = "legacy"
	SSEStreamModeCompact = "compact"
)

var SSEStreamMode = normalizeSSEStreamMode(env.String("SSE_STREAM_MODE", SSEStreamModeCompact))

func normalizeSandboxMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case SandboxModeOff:
		return SandboxModeOff
	case SandboxModeNonMain:
		return SandboxModeNonMain
	default:
		return SandboxModeAll
	}
}

func normalizeSandboxScope(scope string) string {
	switch strings.TrimSpace(strings.ToLower(scope)) {
	case "shared":
		return "shared"
	case "agent":
		return "agent"
	default:
		return "session"
	}
}

func normalizeSandboxWorkspaceAccess(access string) string {
	switch strings.TrimSpace(strings.ToLower(access)) {
	case "none":
		return "none"
	case "ro":
		return "ro"
	default:
		return "rw"
	}
}

func IsSandboxRuntimeEnabled() bool {
	return normalizeSandboxMode(SandboxMode) != SandboxModeOff
}

func IsSandboxRuntimeProviderEnabled() bool {
	return IsSandboxRuntimeEnabled() && strings.TrimSpace(SandboxRuntimeProvider) != ""
}

func normalizeSSEStreamMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case SSEStreamModeCompact:
		return SSEStreamModeCompact
	default:
		return SSEStreamModeLegacy
	}
}

func IsSSECompactMode() bool {
	return normalizeSSEStreamMode(SSEStreamMode) == SSEStreamModeCompact
}

// 批量上传默认配置（硬编码）
const (
	BATCH_UPLOAD_TIMEOUT_HOURS          = 24
	BATCH_UPLOAD_CLEANUP_INTERVAL_HOURS = 1
	WEBSOCKET_READ_BUFFER_SIZE          = 1024
	WEBSOCKET_WRITE_BUFFER_SIZE         = 1024
	FOLDER_UPLOAD_MAX_DEPTH             = 10
)

var FOLDER_UPLOAD_SUPPORTED_FORMATS = []string{".txt", ".md", ".html", ".htm"}

// 获取批量上传超时时间
func GetBatchUploadTimeout() time.Duration {
	return time.Duration(BATCH_UPLOAD_TIMEOUT_HOURS) * time.Hour
}

// 获取批量上传清理间隔
func GetBatchUploadCleanupInterval() time.Duration {
	return time.Duration(BATCH_UPLOAD_CLEANUP_INTERVAL_HOURS) * time.Hour
}

func GetApiHost() string {
	if !strings.HasSuffix(ApiHost, "/") {
		return ApiHost + "/"
	}
	return ApiHost
}

// GetDocConvertBaseURL 获取文档转换服务基础URL
func GetDocConvertBaseURL() string {
	if DocConvertBaseURL == "" {
		return ""
	}
	if !strings.HasSuffix(DocConvertBaseURL, "/") {
		return DocConvertBaseURL + "/"
	}
	return DocConvertBaseURL
}

func GetEID(c *gin.Context) int64 {
	eid, success := c.Get(session.ENV_EID)
	if success && eid != nil {
		return eid.(int64)
	} else {
		return env.Int64("EID", 1)
	}
}

func GetUserId(c *gin.Context) int64 {
	user_id, success := c.Get(session.SESSION_USER_ID)
	if success && user_id != nil {
		return user_id.(int64)
	}
	return 0
}

func GetUserNickname(c *gin.Context) string {
	nickanme, success := c.Get(session.SESSION_USER_NICKNAME)
	if success && nickanme != nil {
		return nickanme.(string)
	}
	return ""
}

// GetUserGroup returns the group id of the user
func GetUserGroupID(c *gin.Context) int64 {
	group_id, success := c.Get(session.SESSION_USER_GROUP_ID)
	if success && group_id != nil {
		return group_id.(int64)
	}
	return 0
}

// GetProtocol returns the request protocol from session
func GetProtocol(c *gin.Context) string {
	protocol, success := c.Get(session.SESSION_REQUEST_PROTOCOL)
	if success && protocol != nil {
		return protocol.(string)
	}
	return "http"
}

// GetDomain returns the request domain from session
func GetDomain(c *gin.Context) string {
	domain, success := c.Get(session.SESSION_REQUEST_DOMAIN)
	if success && domain != nil {
		return domain.(string)
	}
	return ""
}

func GetServer(c *gin.Context) string {
	return Server
}

func Getwd() string {
	workDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	return workDir
}

func GetBinScriptPath(shName string) string {
	workDir := Getwd()
	base := filepath.Base(workDir)
	if base == "bin" {
		return filepath.Join(workDir, shName)
	} else {
		return filepath.Join(workDir, "bin", shName)
	}
}

func GetWecomSuiteID() string {
	return WECOM_SUITE_ID
}

func GetDingtalkSuiteID() string {
	return DINGTALK_SUITE_ID
}

func GetUserRole(c *gin.Context) int64 {
	role, success := c.Get(session.SESSION_USER_ROLE)
	if success && role != nil {
		return role.(int64)
	}
	return 0 // 默认返回 0，表示无权限或未登录
}
