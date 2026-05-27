package model

// FileOriginType 用于标识文件的来源类型。
// 这组值用于区分“谁创建了文件”，例如手动创建、个人上传、AI 生成。
const (
	FileOriginTypeManualCreate      = "manual_create"
	FileOriginTypePersonalUpload    = "personal_upload"
	FileOriginTypeAIGenerated       = "ai_generated"
	FileOriginTypeRecordingAudio    = "recording_audio"
	FileOriginTypeRecordingFolder   = "recording_folder"
	FileOriginTypeRecordingImported = "recording_imported"
)

// FileOriginSource 用于标识文件来源的细分渠道。
// 这组值用于补充来源语义，例如直接创建、本地上传、AI 生成。
const (
	FileOriginSourceDirect          = "direct"
	FileOriginSourceLocal           = "local"
	FileOriginSourceAI              = "ai"
	FileOriginSourceRecording       = "recording"
	FileOriginSourceRecordingImport = "recording_import"
)

// RecordingOriginTypes 表示“我的录音”业务的文件来源类型集合。
func RecordingOriginTypes() []string {
	return []string{
		FileOriginTypeRecordingAudio,
		FileOriginTypeRecordingFolder,
		FileOriginTypeRecordingImported,
	}
}

// SpaceKind 表示空间的类型。
// regular 是普通空间，personal_company 是企业级个人空间。
const (
	SpaceKindRegular         = "regular"
	SpaceKindPersonalCompany = "personal_company"
)

// LibraryKind 表示知识库的类型。
// regular 是普通知识库，personal_user 是用户个人知识库。
const (
	LibraryKindRegular      = "regular"
	LibraryKindPersonalUser = "personal_user"
)

// PersonalSpaceNamePattern / PersonalLibraryNamePattern 用于生成系统自动创建的个人空间和个人知识库名称。
const (
	PersonalSpaceNamePattern   = "__personal_space__%d"
	PersonalLibraryNamePattern = "__personal_library__%d"
)
