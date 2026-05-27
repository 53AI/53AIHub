package controller

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/middleware"
)

func encodeMCPToolOutput(data any) any {
	return encodeMCPValue(data)
}

func encodeMCPValue(data any) any {
	if data == nil {
		return nil
	}

	switch v := data.(type) {
	case map[string]any:
		return encodeMCPMap(v)
	case []any:
		return encodeMCPSlice(v)
	}

	rv := reflect.ValueOf(data)
	if !rv.IsValid() {
		return nil
	}

	switch rv.Kind() {
	case reflect.Ptr:
		if rv.IsNil() {
			return nil
		}
		return encodeMCPValue(rv.Elem().Interface())
	case reflect.Struct:
		return encodeMCPValue(middleware.EncodeStructIDs(data))
	case reflect.Slice, reflect.Array:
		return encodeMCPReflectSlice(rv)
	case reflect.Map:
		return encodeMCPReflectMap(rv)
	default:
		return data
	}
}

func encodeMCPMap(input map[string]any) map[string]any {
	result := make(map[string]any, len(input))
	for key, value := range input {
		if isMCPIDField(key) {
			if encodedValue, ok := encodeMCPIDValue(value); ok {
				result[key] = encodedValue
				continue
			}
			if encodedValues, ok := encodeMCPIDSlice(value); ok {
				result[key] = encodedValues
				continue
			}
		}
		result[key] = encodeMCPValue(value)
	}
	return result
}

func encodeMCPSlice(input []any) []any {
	result := make([]any, len(input))
	for i, item := range input {
		result[i] = encodeMCPValue(item)
	}
	return result
}

func encodeMCPReflectSlice(v reflect.Value) []any {
	result := make([]any, v.Len())
	for i := 0; i < v.Len(); i++ {
		result[i] = encodeMCPValue(v.Index(i).Interface())
	}
	return result
}

func encodeMCPReflectMap(v reflect.Value) map[string]any {
	result := make(map[string]any, v.Len())
	iter := v.MapRange()
	for iter.Next() {
		key := iter.Key()
		keyString := mapKeyToString(key)
		if keyString == "" {
			continue
		}
		value := iter.Value().Interface()
		if isMCPIDField(keyString) {
			if encodedValue, ok := encodeMCPIDValue(value); ok {
				result[keyString] = encodedValue
				continue
			}
			if encodedValues, ok := encodeMCPIDSlice(value); ok {
				result[keyString] = encodedValues
				continue
			}
		}
		result[keyString] = encodeMCPValue(value)
	}
	return result
}

func mapKeyToString(key reflect.Value) string {
	if !key.IsValid() {
		return ""
	}
	if key.Kind() == reflect.String {
		return key.String()
	}
	if key.CanInterface() {
		return fmt.Sprint(key.Interface())
	}
	return ""
}

func encodeMCPIDValue(value any) (any, bool) {
	if value == nil {
		return nil, false
	}

	switch v := value.(type) {
	case int:
		if v > 0 {
			return encodeMCPInt64(int64(v))
		}
	case int32:
		if v > 0 {
			return encodeMCPInt64(int64(v))
		}
	case int64:
		if v > 0 {
			return encodeMCPInt64(v)
		}
	case uint:
		if v > 0 {
			return encodeMCPInt64(int64(v))
		}
	case uint32:
		if v > 0 {
			return encodeMCPInt64(int64(v))
		}
	case uint64:
		if v > 0 && v <= uint64(^uint64(0)>>1) {
			return encodeMCPInt64(int64(v))
		}
	case float32:
		if v > 0 && float32(int64(v)) == v {
			return encodeMCPInt64(int64(v))
		}
	case float64:
		if v > 0 && float64(int64(v)) == v {
			return encodeMCPInt64(int64(v))
		}
	case string:
		if id, err := strconv.ParseInt(v, 10, 64); err == nil && id > 0 {
			return encodeMCPInt64(id)
		}
	}

	rv := reflect.ValueOf(value)
	if rv.IsValid() && rv.Kind() == reflect.Ptr && !rv.IsNil() {
		return encodeMCPIDValue(rv.Elem().Interface())
	}

	return nil, false
}

func encodeMCPIDSlice(value any) ([]any, bool) {
	rv := reflect.ValueOf(value)
	if !rv.IsValid() {
		return nil, false
	}
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil, false
	}

	result := make([]any, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		item := rv.Index(i).Interface()
		if encoded, ok := encodeMCPIDValue(item); ok {
			result[i] = encoded
			continue
		}
		result[i] = encodeMCPValue(item)
	}
	return result, true
}

func encodeMCPInt64(id int64) (any, bool) {
	encoded, err := hashids.Encode(id)
	if err != nil {
		return nil, false
	}
	return encoded, true
}

func isMCPIDField(fieldName string) bool {
	if hashids.IsIDField(fieldName) {
		return true
	}

	fieldLower := strings.ToLower(fieldName)
	switch fieldLower {
	case "owner_id", "creator_id", "user_id", "deleted_by", "disabled_by", "created_by", "updated_by":
		return true
	}

	return strings.HasSuffix(fieldName, "_id") ||
		strings.HasSuffix(fieldName, "_ids") ||
		strings.HasSuffix(fieldName, "Id") ||
		strings.HasSuffix(fieldName, "ID") ||
		strings.HasSuffix(fieldName, "IDs")
}
