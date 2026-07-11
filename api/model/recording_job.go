package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/config"
	"gorm.io/gorm"
)

const (
	RecordingJobStatusIdle                 = "idle"
	RecordingJobStatusRecording            = "recording"
	RecordingJobStatusPaused               = "paused"
	RecordingJobStatusInterrupted          = "interrupted"
	RecordingJobStatusFinalizing           = "finalizing"
	RecordingJobStatusFinalizingProcessing = "finalizing_processing"
	RecordingJobStatusCompleted            = "completed"
	RecordingJobStatusFailed               = "failed"
	RecordingJobStatusStopped              = "stopped"
)

const (
	RecordingJobSegmentStatusPending  = "pending"
	RecordingJobSegmentStatusUploaded = "uploaded"
	RecordingJobSegmentStatusFailed   = "failed"
)

const (
	RecordingJobSegmentTranscodeStatusPending     = "pending"
	RecordingJobSegmentTranscodeStatusTranscoding = "transcoding"
	RecordingJobSegmentTranscodeStatusTranscoded  = "transcoded"
	RecordingJobSegmentTranscodeStatusFailed      = "failed"
)

type RecordingJob struct {
	ID                       int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                      int64  `json:"eid" gorm:"not null;index:idx_recording_jobs_eid_user_status,priority:1;index:idx_recording_jobs_eid_library_status,priority:1"`
	OwnerInstance            string `json:"owner_instance" gorm:"size:64;not null;default:'';index"`
	UserID                   int64  `json:"user_id" gorm:"not null;index:idx_recording_jobs_eid_user_status,priority:2"`
	LibraryID                int64  `json:"library_id" gorm:"not null;index:idx_recording_jobs_eid_library_status,priority:2"`
	DestinationFolderFileID  int64  `json:"destination_folder_file_id" gorm:"not null;default:0;index"`
	Title                    string `json:"title" gorm:"size:255;not null;default:''"`
	Status                   string `json:"status" gorm:"size:32;not null;default:'idle';index:idx_recording_jobs_eid_user_status,priority:3;index:idx_recording_jobs_eid_library_status,priority:3"`
	TargetFormat             string `json:"target_format" gorm:"size:20;not null;default:'m4a'"`
	SourceMimeType           string `json:"source_mime_type" gorm:"size:128;not null;default:''"`
	UploadIntervalMs         int64  `json:"upload_interval_ms" gorm:"not null;default:3000"`
	MaxDurationMs            int64  `json:"max_duration_ms" gorm:"not null;default:28800000"`
	StartedAt                int64  `json:"started_at" gorm:"not null;default:0"`
	PausedAt                 int64  `json:"paused_at" gorm:"not null;default:0"`
	ResumedAt                int64  `json:"resumed_at" gorm:"not null;default:0"`
	EndedAt                  int64  `json:"ended_at" gorm:"not null;default:0"`
	LastActiveAt             int64  `json:"last_active_at" gorm:"not null;default:0"`
	TotalRecordedMs          int64  `json:"total_recorded_ms" gorm:"not null;default:0"`
	UploadedRecordedMs       int64  `json:"uploaded_recorded_ms" gorm:"not null;default:0"`
	SegmentCount             int64  `json:"segment_count" gorm:"not null;default:0"`
	UploadedSegmentCount     int64  `json:"uploaded_segment_count" gorm:"not null;default:0"`
	LastSegmentIndex         int64  `json:"last_segment_index" gorm:"not null;default:-1"`
	NextExpectedSegmentIndex int64  `json:"next_expected_segment_index" gorm:"not null;default:0"`
	LastAcceptedSegmentIndex int64  `json:"last_accepted_segment_index" gorm:"not null;default:-1"`
	RecoveryState            string `json:"recovery_state" gorm:"size:32;not null;default:'ready'"`
	RecoveryError            string `json:"recovery_error" gorm:"type:text"`
	LastRecoveredAt          int64  `json:"last_recovered_at" gorm:"not null;default:0"`
	OutputFileID             int64  `json:"output_file_id" gorm:"not null;default:0;index"`
	LastError                string `json:"last_error" gorm:"type:text"`
	BaseModel
}

type RecordingJobSegment struct {
	ID                   int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	JobID                int64  `json:"job_id" gorm:"not null;uniqueIndex:idx_recording_segments_job_index,priority:1;index:idx_recording_segments_eid_user_status,priority:3"`
	Eid                  int64  `json:"eid" gorm:"not null;index:idx_recording_segments_eid_user_status,priority:1"`
	OwnerInstance        string `json:"owner_instance" gorm:"size:64;not null;default:'';index"`
	UserID               int64  `json:"user_id" gorm:"not null;index:idx_recording_segments_eid_user_status,priority:2"`
	SegmentIndex         int64  `json:"segment_index" gorm:"not null;uniqueIndex:idx_recording_segments_job_index,priority:2"`
	StorageKey           string `json:"storage_key" gorm:"size:512;not null;default:''"`
	SegmentHash          string `json:"segment_hash" gorm:"size:128;not null;default:''"`
	MimeType             string `json:"mime_type" gorm:"size:128;not null;default:''"`
	Size                 int64  `json:"size" gorm:"not null;default:0"`
	DurationMs           int64  `json:"duration_ms" gorm:"not null;default:0"`
	StartOffsetMs        int64  `json:"start_offset_ms" gorm:"not null;default:0"`
	EndOffsetMs          int64  `json:"end_offset_ms" gorm:"not null;default:0"`
	Status               string `json:"status" gorm:"size:20;not null;default:'pending';index:idx_recording_segments_eid_user_status,priority:4"`
	TranscodeStatus      string `json:"transcode_status" gorm:"size:20;not null;default:'pending';index"`
	TranscodedStorageKey string `json:"transcoded_storage_key" gorm:"size:512;not null;default:''"`
	TranscodedMimeType   string `json:"transcoded_mime_type" gorm:"size:128;not null;default:''"`
	TranscodedSize       int64  `json:"transcoded_size" gorm:"not null;default:0"`
	TranscodeError       string `json:"transcode_error" gorm:"type:text"`
	RetryCount           int    `json:"retry_count" gorm:"not null;default:0"`
	UploadedAt           int64  `json:"uploaded_at" gorm:"not null;default:0"`
	BaseModel
}

type RecordingJobSegmentPublicView struct {
	ID                 int64  `json:"id"`
	JobID              int64  `json:"job_id"`
	SegmentIndex       int64  `json:"segment_index"`
	MimeType           string `json:"mime_type"`
	Size               int64  `json:"size"`
	DurationMs         int64  `json:"duration_ms"`
	StartOffsetMs      int64  `json:"start_offset_ms"`
	EndOffsetMs        int64  `json:"end_offset_ms"`
	Status             string `json:"status"`
	TranscodeStatus    string `json:"transcode_status"`
	TranscodedMimeType string `json:"transcoded_mime_type"`
	TranscodedSize     int64  `json:"transcoded_size"`
	UploadedAt         int64  `json:"uploaded_at"`
	CreatedTime        int64  `json:"created_time"`
	UpdatedTime        int64  `json:"updated_time"`
}

func (j *RecordingJob) Normalize() {
	if j == nil {
		return
	}
	j.Title = strings.TrimSpace(j.Title)
	if j.Title == "" {
		j.Title = "录音"
	}
	if strings.TrimSpace(j.TargetFormat) == "" {
		j.TargetFormat = "m4a"
	}
	if j.UploadIntervalMs <= 0 {
		j.UploadIntervalMs = 3000
	}
	if j.MaxDurationMs <= 0 {
		j.MaxDurationMs = 8 * 60 * 60 * 1000
	}
	if j.Status == "" {
		j.Status = RecordingJobStatusIdle
	}
	if j.LastSegmentIndex < 0 {
		j.LastSegmentIndex = -1
	}
	if j.NextExpectedSegmentIndex < 0 {
		j.NextExpectedSegmentIndex = 0
	}
	if j.LastAcceptedSegmentIndex < 0 {
		j.LastAcceptedSegmentIndex = -1
	}
	if strings.TrimSpace(j.RecoveryState) == "" {
		j.RecoveryState = "ready"
	}
	j.RecoveryError = strings.TrimSpace(j.RecoveryError)
	if j.LastRecoveredAt < 0 {
		j.LastRecoveredAt = 0
	}
	j.OwnerInstance = normalizeRecordingInstanceID(j.OwnerInstance)
}

func (j *RecordingJob) BeforeCreate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(j.OwnerInstance) == "" {
		j.OwnerInstance = recordingCurrentInstanceID()
	}
	j.Normalize()
	if err := j.BaseModel.BeforeCreate(tx); err != nil {
		return err
	}
	return nil
}

func (j *RecordingJob) BeforeUpdate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(j.OwnerInstance) == "" {
		j.OwnerInstance = recordingCurrentInstanceID()
	}
	j.Normalize()
	if err := j.BaseModel.BeforeUpdate(tx); err != nil {
		return err
	}
	return nil
}

func (j *RecordingJob) PublicView() *RecordingJobPublicView {
	if j == nil {
		return nil
	}
	return &RecordingJobPublicView{
		ID:                       j.ID,
		UserID:                   j.UserID,
		DestinationFolderFileID:  j.DestinationFolderFileID,
		Title:                    j.Title,
		Status:                   j.Status,
		TargetFormat:             j.TargetFormat,
		UploadIntervalMs:         j.UploadIntervalMs,
		MaxDurationMs:            j.MaxDurationMs,
		StartedAt:                j.StartedAt,
		PausedAt:                 j.PausedAt,
		ResumedAt:                j.ResumedAt,
		EndedAt:                  j.EndedAt,
		LastActiveAt:             j.LastActiveAt,
		TotalRecordedMs:          j.TotalRecordedMs,
		UploadedRecordedMs:       j.UploadedRecordedMs,
		SegmentCount:             j.SegmentCount,
		UploadedSegmentCount:     j.UploadedSegmentCount,
		NextExpectedSegmentIndex: j.NextExpectedSegmentIndex,
		LastAcceptedSegmentIndex: j.LastAcceptedSegmentIndex,
		RecoveryState:            j.RecoveryState,
		RecoveryError:            j.RecoveryError,
		LastRecoveredAt:          j.LastRecoveredAt,
		OutputFileID:             j.OutputFileID,
		LastError:                j.LastError,
		CreatedTime:              j.CreatedTime,
		UpdatedTime:              j.UpdatedTime,
	}
}

type RecordingJobPublicView struct {
	ID                       int64  `json:"id"`
	UserID                   int64  `json:"user_id"`
	DestinationFolderFileID  int64  `json:"destination_folder_file_id"`
	Title                    string `json:"title"`
	Status                   string `json:"status"`
	TargetFormat             string `json:"target_format"`
	UploadIntervalMs         int64  `json:"upload_interval_ms"`
	MaxDurationMs            int64  `json:"max_duration_ms"`
	StartedAt                int64  `json:"started_at"`
	PausedAt                 int64  `json:"paused_at"`
	ResumedAt                int64  `json:"resumed_at"`
	EndedAt                  int64  `json:"ended_at"`
	LastActiveAt             int64  `json:"last_active_at"`
	TotalRecordedMs          int64  `json:"total_recorded_ms"`
	UploadedRecordedMs       int64  `json:"uploaded_recorded_ms"`
	SegmentCount             int64  `json:"segment_count"`
	UploadedSegmentCount     int64  `json:"uploaded_segment_count"`
	NextExpectedSegmentIndex int64  `json:"next_expected_segment_index"`
	LastAcceptedSegmentIndex int64  `json:"last_accepted_segment_index"`
	RecoveryState            string `json:"recovery_state"`
	RecoveryError            string `json:"recovery_error"`
	LastRecoveredAt          int64  `json:"last_recovered_at"`
	OutputFileID             int64  `json:"output_file_id"`
	LastError                string `json:"last_error"`
	CreatedTime              int64  `json:"created_time"`
	UpdatedTime              int64  `json:"updated_time"`
}

func (j *RecordingJob) IsActive() bool {
	if j == nil {
		return false
	}
	switch j.Status {
	case RecordingJobStatusRecording, RecordingJobStatusPaused, RecordingJobStatusInterrupted, RecordingJobStatusFinalizing, RecordingJobStatusFinalizingProcessing:
		return true
	default:
		return false
	}
}

func (j *RecordingJob) CanResume() bool {
	if j == nil {
		return false
	}
	return j.Status == RecordingJobStatusPaused || j.Status == RecordingJobStatusInterrupted || j.Status == RecordingJobStatusFailed
}

func (j *RecordingJob) CanFinalize() bool {
	if j == nil {
		return false
	}
	switch j.Status {
	case RecordingJobStatusRecording, RecordingJobStatusPaused, RecordingJobStatusInterrupted:
		return true
	default:
		return false
	}
}

func (j *RecordingJob) CanPause() bool {
	if j == nil {
		return false
	}
	return j.Status == RecordingJobStatusRecording
}

func (j *RecordingJob) CanInterrupt() bool {
	if j == nil {
		return false
	}
	return j.Status == RecordingJobStatusRecording || j.Status == RecordingJobStatusPaused
}

func (j *RecordingJob) CanStop() bool {
	if j == nil {
		return false
	}
	return j.Status == RecordingJobStatusRecording || j.Status == RecordingJobStatusPaused || j.Status == RecordingJobStatusInterrupted
}

func (j *RecordingJob) CanEnterFinalizing() bool {
	if j == nil {
		return false
	}
	return j.CanFinalize() || j.Status == RecordingJobStatusStopped
}

func (j *RecordingJob) IsTerminal() bool {
	if j == nil {
		return false
	}
	switch j.Status {
	case RecordingJobStatusCompleted, RecordingJobStatusFailed:
		return true
	default:
		return false
	}
}

func (j *RecordingJobSegment) Normalize() {
	if j == nil {
		return
	}
	if strings.TrimSpace(j.Status) == "" {
		j.Status = RecordingJobSegmentStatusPending
	}
	if strings.TrimSpace(j.TranscodeStatus) == "" {
		j.TranscodeStatus = RecordingJobSegmentTranscodeStatusPending
	}
	j.OwnerInstance = normalizeRecordingInstanceID(j.OwnerInstance)
}

func (j *RecordingJobSegment) BeforeCreate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(j.OwnerInstance) == "" {
		j.OwnerInstance = recordingCurrentInstanceID()
	}
	j.Normalize()
	if err := j.BaseModel.BeforeCreate(tx); err != nil {
		return err
	}
	return nil
}

func (j *RecordingJobSegment) BeforeUpdate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(j.OwnerInstance) == "" {
		j.OwnerInstance = recordingCurrentInstanceID()
	}
	j.Normalize()
	if err := j.BaseModel.BeforeUpdate(tx); err != nil {
		return err
	}
	return nil
}

func (j *RecordingJobSegment) PublicView() *RecordingJobSegmentPublicView {
	if j == nil {
		return nil
	}
	return &RecordingJobSegmentPublicView{
		ID:                 j.ID,
		JobID:              j.JobID,
		SegmentIndex:       j.SegmentIndex,
		MimeType:           j.MimeType,
		Size:               j.Size,
		DurationMs:         j.DurationMs,
		StartOffsetMs:      j.StartOffsetMs,
		EndOffsetMs:        j.EndOffsetMs,
		Status:             j.Status,
		TranscodeStatus:    j.TranscodeStatus,
		TranscodedMimeType: j.TranscodedMimeType,
		TranscodedSize:     j.TranscodedSize,
		UploadedAt:         j.UploadedAt,
		CreatedTime:        j.CreatedTime,
		UpdatedTime:        j.UpdatedTime,
	}
}

func GetRecordingJobByID(eid, jobID int64) (*RecordingJob, error) {
	var job RecordingJob
	if err := DB.Where("eid = ? AND id = ? AND owner_instance = ?", eid, jobID, recordingCurrentInstanceID()).First(&job).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

func GetActiveRecordingJobByUser(eid, userID int64) (*RecordingJob, error) {
	var job RecordingJob
	if err := DB.Where("eid = ? AND user_id = ? AND owner_instance = ? AND status IN ?", eid, userID, recordingCurrentInstanceID(), []string{
		RecordingJobStatusRecording,
		RecordingJobStatusPaused,
		RecordingJobStatusInterrupted,
		RecordingJobStatusFinalizing,
		RecordingJobStatusFinalizingProcessing,
	}).Order("updated_time DESC, id DESC").First(&job).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

func CountActiveRecordingJobs(eid, userID int64) (int64, error) {
	var count int64
	if err := DB.Model(&RecordingJob{}).Where("eid = ? AND user_id = ? AND owner_instance = ? AND status IN ?", eid, userID, recordingCurrentInstanceID(), []string{
		RecordingJobStatusRecording,
		RecordingJobStatusPaused,
		RecordingJobStatusInterrupted,
		RecordingJobStatusFinalizing,
		RecordingJobStatusFinalizingProcessing,
	}).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func CreateRecordingJob(job *RecordingJob) error {
	if job == nil {
		return errors.New("recording job is nil")
	}
	if strings.TrimSpace(job.OwnerInstance) == "" {
		job.OwnerInstance = recordingCurrentInstanceID()
	}
	job.Normalize()
	return DB.Create(job).Error
}

func UpdateRecordingJob(job *RecordingJob, fields map[string]interface{}) error {
	if job == nil {
		return errors.New("recording job is nil")
	}
	if len(fields) == 0 {
		return nil
	}
	instanceID := recordingEnsureInstanceID(job.OwnerInstance)
	fields["updated_time"] = time.Now().UTC().UnixMilli()
	return DB.Model(&RecordingJob{}).
		Where("id = ? AND owner_instance = ?", job.ID, instanceID).
		Updates(fields).Error
}

func UpsertRecordingJobSegment(segment *RecordingJobSegment) (bool, error) {
	if segment == nil {
		return false, errors.New("recording segment is nil")
	}
	if strings.TrimSpace(segment.OwnerInstance) == "" {
		segment.OwnerInstance = recordingCurrentInstanceID()
	}
	segment.Normalize()
	var existing RecordingJobSegment
	err := DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ?", segment.JobID, segment.SegmentIndex, segment.OwnerInstance).First(&existing).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		return true, DB.Create(segment).Error
	}
	segment.ID = existing.ID
	return false, DB.Model(&existing).Updates(map[string]interface{}{
		"storage_key":            segment.StorageKey,
		"segment_hash":           segment.SegmentHash,
		"mime_type":              segment.MimeType,
		"size":                   segment.Size,
		"duration_ms":            segment.DurationMs,
		"start_offset_ms":        segment.StartOffsetMs,
		"end_offset_ms":          segment.EndOffsetMs,
		"status":                 segment.Status,
		"transcode_status":       segment.TranscodeStatus,
		"transcoded_storage_key": segment.TranscodedStorageKey,
		"transcoded_mime_type":   segment.TranscodedMimeType,
		"transcoded_size":        segment.TranscodedSize,
		"transcode_error":        segment.TranscodeError,
		"retry_count":            segment.RetryCount,
		"uploaded_at":            segment.UploadedAt,
		"updated_time":           time.Now().UTC().UnixMilli(),
	}).Error
}

func UpdateRecordingJobSegmentByIndex(jobID, segmentIndex int64, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}
	fields["updated_time"] = time.Now().UTC().UnixMilli()
	return DB.Model(&RecordingJobSegment{}).
		Where("job_id = ? AND segment_index = ? AND owner_instance = ?", jobID, segmentIndex, recordingCurrentInstanceID()).
		Updates(fields).Error
}

func GetRecordingJobSegmentByIndex(jobID, segmentIndex int64) (*RecordingJobSegment, error) {
	var segment RecordingJobSegment
	if err := DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ?", jobID, segmentIndex, recordingCurrentInstanceID()).First(&segment).Error; err != nil {
		return nil, err
	}
	return &segment, nil
}

func GetRecordingJobSegments(jobID int64) ([]RecordingJobSegment, error) {
	var segments []RecordingJobSegment
	if err := DB.Where("job_id = ? AND owner_instance = ?", jobID, recordingCurrentInstanceID()).Order("segment_index asc").Find(&segments).Error; err != nil {
		return nil, err
	}
	return segments, nil
}

func GetRecordingJobMissingSegmentIndices(jobID int64) ([]int64, error) {
	var segments []RecordingJobSegment
	if err := DB.Where("job_id = ? AND owner_instance = ? AND status = ?", jobID, recordingCurrentInstanceID(), RecordingJobSegmentStatusUploaded).Order("segment_index asc").Find(&segments).Error; err != nil {
		return nil, err
	}
	if len(segments) == 0 {
		return nil, nil
	}
	uploaded := make(map[int64]struct{}, len(segments))
	var maxIndex int64
	for _, segment := range segments {
		uploaded[segment.SegmentIndex] = struct{}{}
		if segment.SegmentIndex > maxIndex {
			maxIndex = segment.SegmentIndex
		}
	}
	var missing []int64
	for i := int64(0); i <= maxIndex; i++ {
		if _, ok := uploaded[i]; !ok {
			missing = append(missing, i)
		}
	}
	return missing, nil
}

func recordingCurrentInstanceID() string {
	instanceID := strings.TrimSpace(config.GetRecordingInstanceID())
	if instanceID == "" {
		instanceID = "default"
	}
	return instanceID
}

func normalizeRecordingInstanceID(instanceID string) string {
	return strings.TrimSpace(instanceID)
}

func recordingEnsureInstanceID(instanceID string) string {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		instanceID = recordingCurrentInstanceID()
	}
	return instanceID
}

func BuildRecordingLocalJobRootPath(eid, userID, jobID int64) string {
	return BuildRecordingLocalJobRootPathForInstance(recordingCurrentInstanceID(), eid, userID, jobID)
}

func BuildRecordingLocalJobRootPathForInstance(instanceID string, eid, userID, jobID int64) string {
	instanceID = recordingEnsureInstanceID(instanceID)
	return filepath.Join(instanceID, fmt.Sprintf("%d", eid), fmt.Sprintf("%d", userID), fmt.Sprintf("%d", jobID))
}

func buildRecordingLocalArtifactName(fileName string, fallback string) string {
	fileName = filepath.Base(strings.TrimSpace(fileName))
	if fileName == "" || fileName == "." || fileName == string(filepath.Separator) {
		fileName = filepath.Base(strings.TrimSpace(fallback))
	}
	if fileName == "" || fileName == "." || fileName == string(filepath.Separator) {
		fileName = fallback
	}
	return fileName
}

func buildRecordingLocalArtifactLeafName(segmentIndex int64, fileName string, fallback string) string {
	cleanedName := buildRecordingLocalArtifactName(fileName, fallback)
	ext := filepath.Ext(cleanedName)
	if ext == "" {
		ext = filepath.Ext(strings.TrimSpace(fallback))
	}
	baseName := strings.TrimSuffix(cleanedName, ext)
	if baseName == "" {
		baseName = strings.TrimSuffix(filepath.Base(strings.TrimSpace(fallback)), filepath.Ext(strings.TrimSpace(fallback)))
	}
	if baseName == "" {
		baseName = "segment"
	}
	sum := sha256.Sum256([]byte(cleanedName))
	shortHash := hex.EncodeToString(sum[:])[:12]
	return fmt.Sprintf("%d_%s_%s%s", segmentIndex, baseName, shortHash, ext)
}

func BuildRecordingChunkLocalStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	return filepath.Join(BuildRecordingLocalJobRootPath(eid, userID, jobID), "chunks", buildRecordingLocalArtifactLeafName(segmentIndex, fileName, "segment.webm"))
}

func BuildRecordingSegmentLocalStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	return filepath.Join(BuildRecordingLocalJobRootPath(eid, userID, jobID), "segments", buildRecordingLocalArtifactLeafName(segmentIndex, fileName, fmt.Sprintf("segment-%d.webm", segmentIndex)))
}

func BuildRecordingSegmentTranscodedLocalStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	return filepath.Join(BuildRecordingLocalJobRootPath(eid, userID, jobID), "transcoded", buildRecordingLocalArtifactLeafName(segmentIndex, fileName, fmt.Sprintf("segment-%d.transcoded", segmentIndex)))
}

func BuildRecordingOutputLocalStorageKey(eid, userID, jobID int64, fileName string) string {
	fileName = buildRecordingLocalArtifactName(fileName, fmt.Sprintf("recording-%d.m4a", jobID))
	return filepath.Join(BuildRecordingLocalJobRootPath(eid, userID, jobID), "output", fileName)
}

func BuildRecordingFinalizeWorkspaceRoot(jobID int64) string {
	return filepath.Join(recordingCurrentInstanceID(), "finalize", fmt.Sprintf("%d", jobID))
}

func BuildRecordingSegmentStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		fileName = fmt.Sprintf("segment-%d.bin", segmentIndex)
	}
	return fmt.Sprintf("recordings/%d/%d/%d/segments/%d_%s", eid, userID, jobID, segmentIndex, fileName)
}

func BuildRecordingOutputStorageKey(eid, userID, jobID int64, fileName string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		fileName = fmt.Sprintf("recording-%d.m4a", jobID)
	}
	return fmt.Sprintf("recordings/%d/%d/%d/output/%s", eid, userID, jobID, fileName)
}

func BuildRecordingSegmentTranscodedStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		fileName = fmt.Sprintf("segment-%d.transcoded", segmentIndex)
	}
	return fmt.Sprintf("recordings/%d/%d/%d/transcoded/%d_%s", eid, userID, jobID, segmentIndex, fileName)
}
