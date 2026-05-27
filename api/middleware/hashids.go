package middleware

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// HashidsDecoder 中间件，自动解码路由参数中的Hashid
func HashidsDecoder() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取所有路由参数
		params := c.Params

		// 遍历所有参数，查找需要解码的ID参数
		for _, param := range params {
			if isIDParam(param.Key) {
				// 尝试解码Hashid
				if decodedID, err := hashids.TryParseID(param.Value); err == nil {
					// 将解码后的数字ID存储到上下文中，供后续处理使用
					c.Set("decoded_"+param.Key, decodedID)
					// 同时保留原始值
					c.Set("original_"+param.Key, param.Value)
				} else {
					// 如果解码失败，返回错误
					c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("Invalid ID format: "+param.Key))
					c.Abort()
					return
				}
			}
		}

		c.Next()
	}
}

// isIDParam 判断参数是否为ID类型参数
func isIDParam(paramName string) bool {
	return hashids.IsIDParam(paramName)
}

// GetDecodedID 从上下文中获取解码后的ID
func GetDecodedID(c *gin.Context, paramName string) (int64, bool) {
	if value, exists := c.Get("decoded_" + paramName); exists {
		if id, ok := value.(int64); ok {
			return id, true
		}
	}
	return 0, false
}

// GetOriginalID 从上下文中获取原始ID字符串
func GetOriginalID(c *gin.Context, paramName string) (string, bool) {
	if value, exists := c.Get("original_" + paramName); exists {
		if id, ok := value.(string); ok {
			return id, true
		}
	}
	return "", false
}

// ParseIDParam 解析路由参数中的ID，优先使用解码后的值
func ParseIDParam(c *gin.Context, paramName string) (int64, error) {
	// 首先尝试从上下文获取解码后的ID
	if decodedID, exists := GetDecodedID(c, paramName); exists {
		return decodedID, nil
	}

	// 如果上下文中没有，直接从路由参数解析
	paramValue := c.Param(paramName)
	if paramValue == "" {
		return 0, errors.New("Missing parameter: " + paramName)
	}

	// 尝试解析为数字ID或Hashid
	return hashids.TryParseID(paramValue)
}

// MustParseIDParam 解析路由参数中的ID，如果失败则返回错误响应并中止请求
func MustParseIDParam(c *gin.Context, paramName string) (int64, bool) {
	id, err := ParseIDParam(c, paramName)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		c.Abort()
		return 0, false
	}
	return id, true
}

// ParseIntParam 解析整数参数（兼容函数，用于替换现有的strconv.Atoi调用）
func ParseIntParam(c *gin.Context, paramName string) (int64, error) {
	return ParseIDParam(c, paramName)
}

// BatchDecodeIDs 批量解码ID数组
func BatchDecodeIDs(encodedIDs []string) ([]int64, error) {
	if len(encodedIDs) == 0 {
		return []int64{}, nil
	}

	decodedIDs := make([]int64, len(encodedIDs))
	for i, encodedID := range encodedIDs {
		decodedID, err := hashids.TryParseID(encodedID)
		if err != nil {
			return nil, err
		}
		decodedIDs[i] = decodedID
	}

	return decodedIDs, nil
}

// BatchEncodeIDs 批量编码ID数组
func BatchEncodeIDs(ids []int64) ([]string, error) {
	if len(ids) == 0 {
		return []string{}, nil
	}

	encodedIDs := make([]string, len(ids))
	for i, id := range ids {
		encodedID, err := hashids.Encode(id)
		if err != nil {
			return nil, err
		}
		encodedIDs[i] = encodedID
	}

	return encodedIDs, nil
}
