package weboffice

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

type Context interface {
	context.Context

	AppID() string
	Token() string
	Query() url.Values
	RequestID() string
	UserModel() *model.User
	Eid() int64
}

type userContext struct {
	context.Context

	appID     string
	token     string
	query     url.Values
	requestID string
	userModel *model.User
	eid       int64
}

type Config struct {
	BaseProvider
	UserProvider
	WatermarkProvider
	EditProvider
	VersionProvider

	Prefix string
	// Logger logger
}

func (uc *userContext) AppID() string {
	return uc.appID
}
func (uc *userContext) Token() string {
	return uc.token
}
func (uc *userContext) Query() url.Values {
	return uc.query
}
func (uc *userContext) RequestID() string {
	return uc.requestID
}

func (uc *userContext) UserModel() *model.User {
	return uc.userModel
}
func (uc *userContext) Eid() int64 {
	return uc.eid
}

func ParseContext(req *http.Request, tkCheck bool) (Context, error) {
	uc := &userContext{
		Context:   req.Context(),
		appID:     req.Header.Get("X-App-ID"),
		token:     req.Header.Get("X-WebOffice-Token"),
		requestID: req.Header.Get("X-Request-ID"),
	}
	if v, err := url.ParseQuery(req.Header.Get("X-User-Query")); err == nil {
		uc.query = v
	} else {
		uc.query = url.Values{}
	}

	tk := uc.query.Get("tk")
	if tk == "" && tkCheck {
		return nil, errors.New("invalid input ticket")
	}

	eid, err := ValidateTicket(tk)
	if err != nil || eid <= 0 {
		return nil, errors.New("ticket error")
	}

	uc.eid = eid

	// 这里直接对接我们的 access token 系统获取用户
	uc.userModel = model.ValidateAccessToken(uc.Token())
	if uc.userModel != nil && uc.userModel.Eid != uc.Eid() {
		return nil, errors.New("user not found")
	}
	return uc, nil
}

type Reply struct {
	Code    Code   `json:"code"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data"`
}

type Empty struct {
}

type GetFileReply struct {
	CreateTime int64  `json:"create_time"`
	CreatorId  string `json:"creator_id"`
	ID         string `json:"id"`
	ModifierId string `json:"modifier_id"`
	ModifyTime int64  `json:"modify_time"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	Version    int32  `json:"version"`
}

type GetFileDownloadReply struct {
	URL        string            `json:"url"`
	Digest     string            `json:"digest"`
	DigestType string            `json:"digest_type"`
	Headers    map[string]string `json:"headers"`
}

type GetFilePermissionReply struct {
	Comment  int    `json:"comment"`
	Copy     int    `json:"copy"`
	Download int    `json:"download"`
	History  int    `json:"history"`
	Print    int    `json:"print"`
	Read     int    `json:"read"`
	Rename   int    `json:"rename"`
	SaveAs   int    `json:"saveas"`
	Update   int    `json:"update"`
	UserId   string `json:"user_id"`
}

type BaseProvider interface {
	GetFile(ctx Context, fileID string) (*GetFileReply, error)
	GetFileDownload(ctx Context, fileID string) (*GetFileDownloadReply, error)
	GetFilePermission(ctx Context, fileID string) (*GetFilePermissionReply, error)
}

type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Logined   bool   `json:"logined"`
}

type UserProvider interface {
	GetUsers(ctx Context, userIDs []string) ([]*User, error)
}

type GetWatermarkReply struct {
	Type       int     `json:"type"`
	Value      string  `json:"value"`
	FillStyle  string  `json:"fill_style"`
	Font       string  `json:"font"`
	Rotate     float64 `json:"rotate"`
	Horizontal int     `json:"horizontal"`
	Vertical   int     `json:"vertical"`
}

type WatermarkProvider interface {
	GetFileWatermark(ctx Context, fileID string) (*GetWatermarkReply, error)
}

type UpdateFile1PhaseArgs struct {
	Name     string
	Size     int64
	SHA1     string
	IsManual bool
	Content  io.Reader
}

type EditProvider interface {
	UpdateFile(ctx Context, fileID string, args *UpdateFile1PhaseArgs) (*GetFileReply, error)
	RenameFile(ctx Context, fileID string, args *RenameFileArgs) error
}

type RenameFileArgs struct {
	Name string `json:"name"`
}

type VersionProvider interface {
	GetFileVersions(ctx Context, fileID string, offset, limit int) ([]*GetFileReply, error)
	GetFileVersion(ctx Context, fileID string, version int32) (*GetFileReply, error)
	GetFileVersionDownload(ctx Context, fileID string, version int32) (*GetFileDownloadReply, error)
}

// GenerateTicket 生成包含ID和时间戳的ticket
func GenerateTicket(id int64) (string, error) {
	h := hashids.GetInstance()

	// 编码ID
	idEncoded, err := h.Encode(id)
	if err != nil {
		return "", err
	}

	// 编码当前时间戳（毫秒）
	timestamp := time.Now().UnixMilli()
	timestampEncoded, err := h.Encode(timestamp)
	if err != nil {
		return "", err
	}

	// 用下划线连接
	return idEncoded + "_" + timestampEncoded, nil
}

// ValidateTicket 验证ticket格式和是否为今天生成
func ValidateTicket(tk string) (int64, error) {
	if tk == "" {
		return 0, errors.New("ticket cannot be empty")
	}

	// 按下划线分割
	parts := strings.Split(tk, "_")
	if len(parts) != 2 {
		return 0, errors.New("invalid ticket format")
	}

	idPart := parts[0]
	timestampPart := parts[1]

	// 解码ID
	h := hashids.GetInstance()
	id, err := h.Decode(idPart)
	if err != nil {
		return 0, errors.New("failed to decode ID part: " + err.Error())
	}

	// 解码时间戳
	timestamp, err := h.Decode(timestampPart)
	if err != nil {
		return 0, errors.New("failed to decode timestamp part: " + err.Error())
	}

	// 验证时间戳是否为今天
	ticketTime := time.UnixMilli(timestamp)
	now := time.Now()

	// 检查是否是同一天（忽略时分秒）
	if ticketTime.Year() != now.Year() || ticketTime.Month() != now.Month() || ticketTime.Day() != now.Day() {
		return 0, errors.New("ticket is expired (not generated today)")
	}

	return id, nil
}
