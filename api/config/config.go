package config

import (
	"os"
	"path/filepath"
	"time"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/gin-gonic/gin"
)

var Version = env.String("HUB_VERSION", "v0.1.0")

// build time make file
// go build -ldflags "-X 'config.VersionTime=$(date +%Y%m%d%H%M)'"
var VersionTime string
var Server = env.String("HUB_SERVER", "")
var LogDir = env.String("LOG_DIR", "")
var DebugEnabled = env.Bool("DEBUG", false)
var OnlyOneLogFile = env.Bool("ONLY_ONE_LOG_FILE", false)
var StartTime = time.Now().Format("2006-01-02 15:04:05")
var IS_SAAS = env.Bool("IS_SAAS", false)
var ApiHost = env.String("API_HOST", "")

var REDIS_CONN = env.String("REDIS_CONN", "")
var MAX_UPLOAD_FILE_SIZE_STRING = env.String("MAX_UPLOAD_FILE_SIZE", "15MB")
var MAX_UPLOAD_FILE_SIZE, _ = helper.ParseSize(MAX_UPLOAD_FILE_SIZE_STRING)

var CHANNEL_RETRY_TIMES = env.Int64("CHANNEL_RETRY_TIMES", 3)
var EnforceIncludeUsage = env.Bool("ENFORCE_INCLUDE_USAGE", false)

var PreConsumedQuota int64 = 500

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

// GetUserGroup returns the group id of the user
func GetUserGroupID(c *gin.Context) int64 {
	group_id, success := c.Get(session.SESSION_USER_GROUP_ID)
	if success && group_id != nil {
		return group_id.(int64)
	}
	return 0
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
