package middleware

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/gin-gonic/gin"
)

// Context key for bypassing ID encryption
const SkipIDEncryption = "skip_id_encryption"

// ResponseEncoder 中间件，自动编码响应数据中的ID字段
func ResponseEncoder() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 创建自定义的ResponseWriter来拦截响应
		writer := &responseWriter{
			ResponseWriter: c.Writer,
			c:              c,
		}
		c.Writer = writer

		c.Next()
	}
}

type responseWriter struct {
	gin.ResponseWriter
	c *gin.Context
}

func (w *responseWriter) Write(data []byte) (int, error) {
	// 检查是否跳过ID加密
	if shouldSkip, exists := w.c.Get(SkipIDEncryption); exists && shouldSkip.(bool) {
		return w.ResponseWriter.Write(data)
	}

	// 只处理JSON响应
	contentType := w.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		return w.ResponseWriter.Write(data)
	}

	// 解析JSON数据
	var jsonData interface{}
	if err := json.Unmarshal(data, &jsonData); err != nil {
		// 如果解析失败，直接返回原数据
		return w.ResponseWriter.Write(data)
	}

	// 编码ID字段
	encodedData := encodeIDFields(jsonData)

	// 重新序列化
	encodedBytes, err := json.Marshal(encodedData)
	if err != nil {
		// 如果序列化失败，返回原数据
		return w.ResponseWriter.Write(data)
	}

	return w.ResponseWriter.Write(encodedBytes)
}

// encodeIDFields 递归编码数据结构中的ID字段
func encodeIDFields(data interface{}) interface{} {
	if data == nil {
		return nil
	}

	switch v := data.(type) {
	case map[string]interface{}:
		return encodeMapFields(v)
	case []interface{}:
		return encodeSliceFields(v)
	default:
		return data
	}
}

// encodeMapFields 编码map中的ID字段
func encodeMapFields(m map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})

	for key, value := range m {
		if isIDField(key) {
			// 尝试编码ID字段
			if encodedValue := tryEncodeID(value); encodedValue != nil {
				result[key] = encodedValue
			} else {
				result[key] = value
			}
		} else {
			// 递归处理嵌套结构
			result[key] = encodeIDFields(value)
		}
	}

	return result
}

// encodeSliceFields 编码切片中的ID字段
func encodeSliceFields(s []interface{}) []interface{} {
	result := make([]interface{}, len(s))

	for i, item := range s {
		result[i] = encodeIDFields(item)
	}

	return result
}

// isIDField 判断字段是否为ID类型字段
func isIDField(fieldName string) bool {
	return hashids.IsIDField(fieldName)
}

// tryEncodeID 尝试编码ID值
func tryEncodeID(value interface{}) interface{} {
	// 处理不同类型的ID值
	switch v := value.(type) {
	case int:
		if v > 0 {
			if encoded, err := hashids.Encode(int64(v)); err == nil {
				return encoded
			}
		}
	case int32:
		if v > 0 {
			if encoded, err := hashids.Encode(int64(v)); err == nil {
				return encoded
			}
		}
	case int64:
		if v > 0 {
			if encoded, err := hashids.Encode(v); err == nil {
				return encoded
			}
		}
	case float64:
		// JSON数字通常被解析为float64
		if v > 0 && v == float64(int64(v)) {
			if encoded, err := hashids.Encode(int64(v)); err == nil {
				return encoded
			}
		}
	case string:
		// 如果是字符串形式的数字ID，尝试解析并编码
		if id, err := strconv.ParseInt(v, 10, 64); err == nil && id > 0 {
			if encoded, err := hashids.Encode(id); err == nil {
				return encoded
			}
		}
	}

	return nil
}

// EncodeResponseIDs 手动编码响应数据中的ID字段（用于特殊情况）
func EncodeResponseIDs(data interface{}) interface{} {
	return encodeIDFields(data)
}

// EncodeStructIDs 编码结构体中的ID字段
func EncodeStructIDs(data interface{}) interface{} {
	if data == nil {
		return nil
	}

	v := reflect.ValueOf(data)
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return nil
		}
		v = v.Elem()
	}

	switch v.Kind() {
	case reflect.Struct:
		return encodeStructFields(v)
	case reflect.Slice:
		return encodeSliceStructs(v)
	default:
		return data
	}
}

// encodeStructFields 编码结构体字段
func encodeStructFields(v reflect.Value) interface{} {
	result := make(map[string]interface{})
	t := v.Type()

	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		fieldType := t.Field(i)

		// 跳过未导出的字段
		if !field.CanInterface() {
			continue
		}

		// 获取JSON标签名称
		jsonTag := fieldType.Tag.Get("json")
		if jsonTag == "-" {
			continue
		}

		fieldName := fieldType.Name
		if jsonTag != "" {
			parts := strings.Split(jsonTag, ",")
			if parts[0] != "" {
				fieldName = parts[0]
			}
		}

		fieldValue := field.Interface()

		if isIDField(fieldName) {
			// 尝试编码ID字段
			if encodedValue := tryEncodeID(fieldValue); encodedValue != nil {
				result[fieldName] = encodedValue
			} else {
				result[fieldName] = fieldValue
			}
		} else {
			// 递归处理嵌套结构
			result[fieldName] = EncodeStructIDs(fieldValue)
		}
	}

	return result
}

// encodeSliceStructs 编码结构体切片
func encodeSliceStructs(v reflect.Value) interface{} {
	result := make([]interface{}, v.Len())

	for i := 0; i < v.Len(); i++ {
		result[i] = EncodeStructIDs(v.Index(i).Interface())
	}

	return result
}
