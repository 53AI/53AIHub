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

// Version 硬编码的系统版本号
var Version = "v0.5.3"

var chinaTimeZone = time.FixedZone("UTC+8", 8*60*60)

func formatChinaTime(value time.Time, layout string) string {
	return value.In(chinaTimeZone).Format(layout)
}

// BuildTime 编译时间，通过 init 记录进程启动时间作为构建参考
var BuildTime = formatChinaTime(time.Now(), "20060102150405")

// Server 服务标识
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
var SLOW_LOG_ENABLED = env.Bool("SLOW_LOG_ENABLED", false)
var SLOW_API_THRESHOLD_MS = env.Int("SLOW_API_THRESHOLD_MS", 1000)
var SLOW_SQL_THRESHOLD_MS = env.Int("SLOW_SQL_THRESHOLD_MS", 200)
var DebugEnabled = env.Bool("DEBUG", false)
var OnlyOneLogFile = env.Bool("ONLY_ONE_LOG_FILE", false)

// RAG source weights are rank-fusion experiment knobs. They are deliberately
// environment-configurable so relevance can be tuned against a query set
// without changing the retrieval contract.
var RAGSourceWeightDocument = env.Float64("RAG_SOURCE_WEIGHT_DOCUMENT", 1.0)
var RAGSourceWeightWiki = env.Float64("RAG_SOURCE_WEIGHT_WIKI", 0.8)
var RAGSourceWeightWeb = env.Float64("RAG_SOURCE_WEIGHT_WEB", 1.0)
var RAGSourceFusionRankConstant = env.Int("RAG_SOURCE_FUSION_RANK_CONSTANT", 60)
var StartTime = formatChinaTime(time.Now(), "2006-01-02 15:04:05")
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

// Redis 配置通过惰性函数在调用时读取环境变量，而不是包级变量：
// 包级变量在 import 期求值，晚于 -env/.env 加载（如 cmd/migrate_tool 在
// main() 中 godotenv.Overload），会导致配置冻结为空。惰性读取与
// model.GetDbConn 的 os.Getenv 模式一致，任何时点加载的 env 都生效。
func RedisConn() string { return env.String("REDIS_CONN", "") }

// Redis连接池配置
func RedisPoolSize() int     { return env.Int("REDIS_POOL_SIZE", 100) }
func RedisMinIdleConns() int { return env.Int("REDIS_MIN_IDLE_CONNS", 10) }
func RedisMaxRetries() int   { return env.Int("REDIS_MAX_RETRIES", 5) }

// Redis超时配置（秒）
func RedisDialTimeoutSeconds() int  { return env.Int("REDIS_DIAL_TIMEOUT_SECONDS", 10) }
func RedisReadTimeoutSeconds() int  { return env.Int("REDIS_READ_TIMEOUT_SECONDS", 5) }
func RedisWriteTimeoutSeconds() int { return env.Int("REDIS_WRITE_TIMEOUT_SECONDS", 5) }
func RedisIdleTimeoutMinutes() int  { return env.Int("REDIS_IDLE_TIMEOUT_MINUTES", 10) }
func RedisMaxConnAgeMinutes() int   { return env.Int("REDIS_MAX_CONN_AGE_MINUTES", 30) }

var MAX_UPLOAD_FILE_SIZE_STRING = env.String("MAX_UPLOAD_FILE_SIZE", "30MB")
var MAX_UPLOAD_FILE_SIZE, _ = helper.ParseSize(MAX_UPLOAD_FILE_SIZE_STRING)

var CHANNEL_RETRY_TIMES = env.Int64("CHANNEL_RETRY_TIMES", 3)
var EnforceIncludeUsage = env.Bool("ENFORCE_INCLUDE_USAGE", false)
var COZE_TOKEN_AUTO_REFRESH_ENABLED = env.Bool("COZE_TOKEN_AUTO_REFRESH_ENABLED", true)

var PreConsumedQuota int64 = 500
var WECOM_SUITE_ID = env.String("WECOM_SUITE_ID", "")
var IS_TEST_WECOM_SUITE = env.Bool("IS_TEST_WECOM_SUITE", false)
var HUAWEI_CLOUD_ACCESS_KEY = env.String("HUAWEI_CLOUD_ACCESS_KEY", "")
var DINGTALK_SUITE_ID = env.String("DINGTALK_SUITE_ID", "")

// ==================== SMS 短信配置 ====================
// 短信验证码服务（发送 /api/sms/sendcode，校验 /api/sms/verify）。
// 修改后需重启服务生效（env 启动时读取一次）。

// SMS_ENABLED：是否启用短信服务。
//
//	false=停用（发送接口返回"服务未启用"）；true=启用。
//	注意：关闭后短信登录/注册/重置密码等依赖验证码的流程将不可用。
var SMS_ENABLED = env.Bool("SMS_ENABLED", false)

// SMS_PROVIDER：短信提供商，目前支持：
//
//	"253chuanglan"   = 创蓝253 标准版（走短信模板 Template）
//	"253chuanglanV2" = 创蓝253 V2 版（走模板ID TemplateID，需配置 SMS_TEMPLATE_ID）
//	更换提供商时需同步调整下方账号/模板配置。
var SMS_PROVIDER = env.String("SMS_PROVIDER", "")

// SMS_ACCOUNT / SMS_PASSWORD：提供商账号与密码（Token），在创蓝控制台申请。
var SMS_ACCOUNT = env.String("SMS_ACCOUNT", "")
var SMS_PASSWORD = env.String("SMS_PASSWORD", "")

// SMS_SIGN_NAME：短信签名，如【博思协创】，须在创蓝报备审核通过。
var SMS_SIGN_NAME = env.String("SMS_SIGN_NAME", "")

// SMS_TEMPLATE：短信模板内容（标准版用），为空时使用代码内置兜底模板。
//
//	模板中需包含验证码占位符，创蓝的验证码模板通常自动注入验证码内容。
var SMS_TEMPLATE = env.String("SMS_TEMPLATE", "")

// SMS_CODE_LENGTH：验证码位数，默认 6 位（防爆破，4 位仅 1 万种组合可穷举）。
//
//	调整后需确认短信模板/前端输入框能承载对应位数；位数越大越安全、用户体验越繁琐。
var SMS_CODE_LENGTH = env.Int("SMS_CODE_LENGTH", 6)

// SMS_EXPIRY_TIME：验证码有效期（分钟），默认 15 分钟。
//
//	过短=用户来不及输入；过长=被截获后可利用窗口变大。不建议超过 30。
var SMS_EXPIRY_TIME = env.Int("SMS_EXPIRY_TIME", 15)

// ==================== 短信防刷配置 ====================
// 防短信轰炸 / 验证码爆破。维度：手机号（60s冷却 + 每日10次，代码内固定）+
// IP维度（下方三层，按"窗口内去重手机号数"计数）。
// 阈值按"客户仅部分员工使用系统、单日最多约 100 人"的业务上限设计；
// 若客户规模更大，优先把其出口 IP 加入 SMS_IP_WHITELIST，而非调大阈值（调大=削弱防刷）。

// SMS_IP_BURST_LIMIT：主防线。同一IP段 10 分钟内允许出现的不同手机号数（去重计数）。
//
//	轰炸脚本 1 分钟内即可发出几十个不同号，此值建议保持 ≤30；
//	调小=更灵敏但可能误伤集中使用场景，调大=防刷变松。
var SMS_IP_BURST_LIMIT = env.Int("SMS_IP_BURST_LIMIT", 20)

// SMS_IP_HOURLY_LIMIT：兜底层。同一IP段 1 小时内允许出现的不同手机号数。
//
//	防"慢速换号"轰炸；正常客户单小时远达不到。建议 ≥ SMS_IP_BURST_LIMIT。
var SMS_IP_HOURLY_LIMIT = env.Int("SMS_IP_HOURLY_LIMIT", 40)

// SMS_IP_DAILY_LIMIT：兜底层。同一IP段 1 天内允许出现的不同手机号数。
//
//	业务上限参考：客户单日最多约 100 名员工使用验证码，故默认 100。
//	若某客户一天超过该值（如全员改密日），将其出口IP加入白名单豁免，勿直接调大此值。
var SMS_IP_DAILY_LIMIT = env.Int("SMS_IP_DAILY_LIMIT", 100)

// SMS_IP_WHITELIST：IP 白名单，逗号分隔。支持两种写法，可混用：
//
//  1. CIDR 网段：如 "203.0.113.0/24,10.0.0.0/8"（匹配整段）
//
//  2. 纯 IP（无掩码）：如 "203.0.113.9"（自动按单个 IP 匹配，IPv4 即 /32，IPv6 即 /128）
//
//     命中白名单的 IP 跳过 IP 维度限流（手机号维度 60s+每日10次 仍生效）。
//     用于：大客户/公司固定出口 IP，避免同网段多人使用被 IP 维度误杀。空=不启用。
//     默认值内置 4 个阿里云公网出口 IP（测试/公司办公出口），可按需增删。
var SMS_IP_WHITELIST = env.String("SMS_IP_WHITELIST", "47.99.46.44,116.62.166.32,121.41.58.215,101.37.170.189")

// SMS_IP_BAN_MINUTES：IP 段超限触发拦截后，对该 IP 段的临时封禁时长（分钟）。
//
//	封禁期内该 IP 段发送直接 fail-fast（白名单 IP 豁免）；封禁状态可在 GET /api/sms/security 查看。
var SMS_IP_BAN_MINUTES = env.Int("SMS_IP_BAN_MINUTES", 60)

// SMS_IP_TOTAL_LIMIT：同一 IP 段 10 分钟内允许的总发送次数（含重复手机号）。
//
//	在"去重手机号数"之外补一层，堵"脚本对少量手机号狂发"。
var SMS_IP_TOTAL_LIMIT = env.Int("SMS_IP_TOTAL_LIMIT", 100)

// SMS_EID_DAILY_LIMIT：同一企业(eid)每日短信发送总量上限（控成本/防企业内被薅）。
var SMS_EID_DAILY_LIMIT = env.Int("SMS_EID_DAILY_LIMIT", 500)

// SMS_VERIFY_IP_BURST_LIMIT：同一 IP 段 10 分钟内允许的验证码校验请求数（防验证码爆破）。
var SMS_VERIFY_IP_BURST_LIMIT = env.Int("SMS_VERIFY_IP_BURST_LIMIT", 30)

// SMS_VERIFY_FAIL_COOLDOWN_SECONDS：校验失败后该手机号的冷却秒数（防连续试码）。
var SMS_VERIFY_FAIL_COOLDOWN_SECONDS = env.Int("SMS_VERIFY_FAIL_COOLDOWN_SECONDS", 2)

// SMS_CAPTCHA_REQUIRED：是否要求发送验证码前通过字符验证码（人机校验）。
//
//	true=sendcode 必须带合法 captcha_id/captcha_answer，否则 400；false=可选（带了就校验）。
//	上线建议：先 false 发布、前端接入图形码后置 true。
var SMS_CAPTCHA_REQUIRED = env.Bool("SMS_CAPTCHA_REQUIRED", false)

// SMS_TEST_MOBILES：测试手机号列表（逗号分隔，如 "13800138000,13900139000"）。
//
//	命中的手机号发送验证码时不调用短信提供商（不产生真实费用/短信），验证码固定为 123456，
//	且绕过发送限流（60s 冷却、每日次数），便于测试环境反复联调。
//	验证流程完全不变（仍写入 Redis、TTL、可被 /api/sms/verify 校验）。
//	仅用于测试环境，生产环境请勿配置。
var SMS_TEST_MOBILES = env.String("SMS_TEST_MOBILES", "")

// TRUSTED_PROXIES：可信代理 IP/CIDR（逗号分隔）。
//
//	仅当应用部署在 nginx/网关之后时配置为代理地址，使 c.ClientIP() 正确解析真实客户端IP
//	（防伪造 X-Forwarded-For 绕过 IP 维度限流）。空=不设置（Gin 默认信任所有代理，勿直连公网暴露）。
var TRUSTED_PROXIES = env.String("TRUSTED_PROXIES", "")

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
var AGENT_MAX_TURNS_HARD_LIMIT = env.Int("AGENT_MAX_TURNS_HARD_LIMIT", 30)
var AGENT_MAX_WALL_CLOCK_SECONDS = env.Int("AGENT_MAX_WALL_CLOCK_SECONDS", 900)
var AGENT_MAX_REPEATED_TOOL_CALLS = env.Int("AGENT_MAX_REPEATED_TOOL_CALLS", 3)
var AGENT_MAX_CONSECUTIVE_TOOL_FAILURES = env.Int("AGENT_MAX_CONSECUTIVE_TOOL_FAILURES", 3)

// Agent tool hardening is introduced behind independently reversible flags.
// They default to false so existing agent runs retain their legacy path.
var AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED = env.Bool("AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED", false)
var AGENT_TOOL_PIPELINE_ENABLED = env.Bool("AGENT_TOOL_PIPELINE_ENABLED", false)
var AGENT_TOOL_INPUT_GUARD_ENABLED = env.Bool("AGENT_TOOL_INPUT_GUARD_ENABLED", false)
var AGENT_UNIFIED_TOOL_RESULT_ENABLED = env.Bool("AGENT_UNIFIED_TOOL_RESULT_ENABLED", false)
var AGENT_STRUCTURED_PROVIDER_RETRY_ENABLED = env.Bool("AGENT_STRUCTURED_PROVIDER_RETRY_ENABLED", false)
var AGENT_COMPLETION_POLICY_ENABLED = env.Bool("AGENT_COMPLETION_POLICY_ENABLED", false)
var AGENT_READ_CONTINUATION_ENABLED = env.Bool("AGENT_READ_CONTINUATION_ENABLED", false)
var AGENT_TOOL_ARGUMENT_ADAPTER_ENABLED = env.Bool("AGENT_TOOL_ARGUMENT_ADAPTER_ENABLED", false)
var AGENT_EDIT_V2_ENABLED = env.Bool("AGENT_EDIT_V2_ENABLED", false)
var AGENT_EDIT_NORMALIZED_MATCH_ENABLED = env.Bool("AGENT_EDIT_NORMALIZED_MATCH_ENABLED", false)
var AGENT_EDIT_BATCH_ENABLED = env.Bool("AGENT_EDIT_BATCH_ENABLED", false)
var AGENT_RUN_SHELL_OUTPUT_V2_ENABLED = env.Bool("AGENT_RUN_SHELL_OUTPUT_V2_ENABLED", false)
var RAG_MULTI_LIBRARY_SEARCH_MAX_CONCURRENT = env.Int("RAG_MULTI_LIBRARY_SEARCH_MAX_CONCURRENT", 4)
var RAG_COLLECTION_SEARCH_MAX_CONCURRENT = env.Int("RAG_COLLECTION_SEARCH_MAX_CONCURRENT", 3)
var RAG_SEARCH_ENGINE_MAX_WORKERS = env.Int("RAG_SEARCH_ENGINE_MAX_WORKERS", 3)

var RECORDING_CHUNK_RETAIN_SECONDS = env.Int("RECORDING_CHUNK_RETAIN_SECONDS", 86400)
var RECORDING_LOCAL_ROOT = env.String("RECORDING_LOCAL_ROOT", "")
var RECORDING_INSTANCE_ID = env.String("RECORDING_INSTANCE_ID", "default")
var DashScopeConcurrency = env.Int("DASHSCOPE_CONCURRENCY", 50)

var RECORDING_SPOOL_FLUSH_DURATION_MS = env.Int("RECORDING_SPOOL_FLUSH_DURATION_MS", 300000)

// Chunk 上传临时存储目录配置（避免多实例跨 tmp 目录互相影响）
var CHUNK_UPLOAD_TEMP_DIR = env.String("CHUNK_UPLOAD_TEMP_DIR", "")

// Keystone 监控上报配置
var KEYSTONE_ENABLED = env.Bool("KEYSTONE_ENABLED", false)
var KEYSTONE_ENDPOINT = env.String("KEYSTONE_ENDPOINT", "")
var KEYSTONE_INTEGRATION_KEY = env.String("KEYSTONE_INTEGRATION_KEY", "53ai-km")
var KEYSTONE_SECRET = env.String("KEYSTONE_SECRET", "")
var KEYSTONE_PRODUCT_KEY = env.String("KEYSTONE_PRODUCT_KEY", "53ai-knowledge-management")
var KEYSTONE_SERVICE_KEY = env.String("KEYSTONE_SERVICE_KEY", "km-backend")
var KEYSTONE_ENVIRONMENT_KEY = env.String("KEYSTONE_ENVIRONMENT_KEY", "production")
var KEYSTONE_TIMEOUT_SECONDS = env.Int("KEYSTONE_TIMEOUT_SECONDS", 5)
var KEYSTONE_MAX_RETRIES = env.Int("KEYSTONE_MAX_RETRIES", 2)

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
