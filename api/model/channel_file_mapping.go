package model

import (
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
)

type ChannelFileMapping struct {
	Id             int64  `json:"id"`
	Eid            int64  `json:"eid"`
	ChannelID      int    `json:"channel_id"`
	Model          string `json:"model"`
	FileID         int64  `json:"file_id"`
	ExpirationTime int64  `json:"expiration_time" gorm:"column:expiration_time;default:0"`
	ChannelFileID  string `json:"channel_file_id" gorm:"column:channel_file_id"`
	ApiResponse    string `json:"api_response" gorm:"column:api_response"`
	BaseModel
}

type ObjectStringContent struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

type ContentPart struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func GetChannelFileMapping(eid int64, channelId int64, fileId int64) *ChannelFileMapping {
	var channelFileMapping ChannelFileMapping
	if err := DB.Where("eid = ? AND channel_id = ? AND file_id = ?", eid, channelId, fileId).First(&channelFileMapping).Error; err != nil {
		return nil
	}
	return &channelFileMapping
}

func CreateChannelFileMapping(channelFileMapping *ChannelFileMapping) error {
	return DB.Create(channelFileMapping).Error
}

func UpdateChannelFileMapping(channelFileMapping *ChannelFileMapping) error {
	return DB.Save(channelFileMapping).Error
}

func (obj *ObjectStringContent) GetUploadFile() *UploadFile {
	if obj.Type != "file" && obj.Type != "image" {
		return nil
	}

	content := strings.TrimPrefix(obj.Content, "file_id:")

	fileId, err := strconv.ParseInt(content, 10, 64)
	if err != nil {
		// fallback: hashid decode for string ids
		decodedID, decodeErr := hashids.TryParseID(content)
		if decodeErr != nil {
			logger.SysLogf("get upload file failed: invalid file_id format, raw=%s, err=%v", content, decodeErr)
			return nil
		}
		fileId = decodedID
	}

	file, err := GetUploadFileByID(fileId)
	if err != nil {
		logger.SysLogf("get upload file failed: file not found, raw=%s, file_id=%d, err=%v", content, fileId, err)
		return nil
	}

	return file
}
