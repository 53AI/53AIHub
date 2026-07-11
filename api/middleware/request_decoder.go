package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// RequestDecoder 请求体ID解码中间件
func RequestDecoder() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 只处理JSON请求体
		// if c.GetHeader("Content-Type") != "application/json" {
			// c.Next()
			// return
		// }

		// 只处理POST、PUT、PATCH请求
		method := c.Request.Method
		switch method {
		case "POST", "PUT", "PATCH", "GET", "DELETE":
			unpdatePath(c)
			updateQuery(c)
			updateBody(c)
		}

		c.Next()
	}
}

func updateBody(c *gin.Context) {
	// 读取请求体
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Failed to read request body"))
		c.Abort()
		return
	}

	// 恢复请求体供后续使用
	c.Request.Body = io.NopCloser(bytes.NewBuffer(body))

	// 如果请求体为空，直接继续
	if len(body) == 0 {
		c.Next()
		return
	}

	// 解析JSON
	var requestData interface{}
	if err := json.Unmarshal(body, &requestData); err != nil {
		// JSON解析失败，可能不是JSON格式，直接继续
		c.Next()
		return
	}

	// 解码ID字段
	decodedData := decodeRequestIDs(requestData)

	// 将解码后的数据重新序列化
	decodedBody, err := json.Marshal(decodedData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("Failed to encode request body"))
		c.Abort()
		return
	}

	// 更新请求体
	c.Request.Body = io.NopCloser(bytes.NewBuffer(decodedBody))
	c.Request.ContentLength = int64(len(decodedBody))
}

func unpdatePath(c *gin.Context) {
	// 当路由存在约定的ID参数名时，尝试解码并回填
	params := c.Params
	updated := false

	for i := range params {
		name := params[i].Key
		val := params[i].Value

		// 按约定判断是否为ID参数（如 id、file_id、library_id 等）
		if hashids.IsIDParam(name) {
			if decoded, err := hashids.TryParseID(val); err == nil {
				// 将解码后的数值ID写回到路由参数
				params[i].Value = strconv.FormatInt(decoded, 10)
				// 同时在上下文中保存，便于后续处理函数直接获取
				c.Set("decoded_"+name, decoded)
				updated = true

				// 日志记录
				logger.SysLogf("RequestDecoder: decoded route param '%s' %q -> %d", name, val, decoded)
			}
		}
	}

	if updated {
		c.Params = params
	}
}

func updateQuery(c *gin.Context) {
	// 当查询参数存在约定的ID参数名时，尝试解码并回填
	q := c.Request.URL.Query()
	updated := false

	for key, values := range q {
		// 兼容 snake_case 与 camelCase 的 ID 字段/参数名
		if hashids.IsIDField(key) || hashids.IsIDParam(key) {
			newVals := make([]string, len(values))
			var decodedSlice []int64
			decodedAny := false

			for i, v := range values {
				if v == "" {
					newVals[i] = v
					continue
				}
				if decoded, err := hashids.TryParseID(v); err == nil {
					newVals[i] = strconv.FormatInt(decoded, 10)
					decodedSlice = append(decodedSlice, decoded)
					decodedAny = true
				} else {
					newVals[i] = v
				}
			}

			if decodedAny {
				q[key] = newVals
				updated = true
				// 上下文存储解码结果：单值为 int64，多值为 []int64
				if len(decodedSlice) == 1 {
					c.Set("decoded_"+key, decodedSlice[0])
				} else if len(decodedSlice) > 1 {
					c.Set("decoded_"+key, decodedSlice)
				}
				logger.SysLogf("RequestDecoder: decoded query param '%s' %v -> %v", key, values, newVals)
			}
		}
	}

	if updated {
		c.Request.URL.RawQuery = q.Encode()
	}
}

// decodeRequestIDs 递归解码请求数据中的ID字段
func decodeRequestIDs(data interface{}) interface{} {
	switch v := data.(type) {
	case map[string]interface{}:
		return decodeMapIDs(v)
	case []interface{}:
		return decodeSliceIDs(v)
	default:
		return data
	}
}

// decodeMapIDs 解码map中的ID字段
func decodeMapIDs(m map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})

	for key, value := range m {
		if hashids.IsIDField(key) {
			// 尝试解码ID字段
			if decodedValue := tryDecodeID(value); decodedValue != nil {
				result[key] = decodedValue
			} else {
				result[key] = value
			}
		} else {
			// 递归处理嵌套结构
			result[key] = decodeRequestIDs(value)
		}
	}

	return result
}

// decodeSliceIDs 解码切片中的ID字段
func decodeSliceIDs(s []interface{}) []interface{} {
	result := make([]interface{}, len(s))

	for i, item := range s {
		result[i] = decodeRequestIDs(item)
	}

	return result
}

// tryDecodeID 尝试解码ID值
func tryDecodeID(value interface{}) interface{} {
	switch v := value.(type) {
	case string:
		// 尝试解码字符串ID
		if decoded, err := hashids.TryParseID(v); err == nil {
			return decoded
		}
	case []interface{}:
		// 处理ID数组
		var decodedIDs []int64
		allDecoded := true

		for _, item := range v {
			if strItem, ok := item.(string); ok {
				if decoded, err := hashids.TryParseID(strItem); err == nil {
					decodedIDs = append(decodedIDs, decoded)
				} else {
					allDecoded = false
					break
				}
			} else {
				allDecoded = false
				break
			}
		}

		if allDecoded && len(decodedIDs) > 0 {
			// 转换为interface{}切片
			result := make([]interface{}, len(decodedIDs))
			for i, id := range decodedIDs {
				result[i] = id
			}
			return result
		}
	}

	return nil
}

// DecodeIDsInStruct 手动解码结构体中的ID字段（用于特殊情况）
func DecodeIDsInStruct(data interface{}) interface{} {
	return decodeRequestIDs(data)
}

// BatchDecodeIDStrings 批量解码ID字符串数组
func BatchDecodeIDStrings(encodedIDs []string) ([]int64, error) {
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
