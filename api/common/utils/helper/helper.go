package helper

import (
	"context"
	"crypto/md5"
	"fmt"
	"math/rand"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func GetRequestID(ctx context.Context) string {
	rawRequestId := ctx.Value(RequestIdKey)
	if rawRequestId == nil {
		return ""
	}
	return rawRequestId.(string)
}

const Chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func RandomString(n int) string {
	rand.Seed(time.Now().UnixNano())
	key := make([]byte, n)
	for i := 0; i < n; i++ {
		key[i] = Chars[rand.Intn(len(Chars))]
	}
	return string(key)
}

func PasswordHash(password string, salt string) (string, error) {
	// md5(password+salt)
	combined := password + salt
	hash := md5.Sum([]byte(combined))
	return fmt.Sprintf("%x", hash), nil
}

var sizeKB = 1024
var sizeMB = sizeKB * 1024
var sizeGB = sizeMB * 1024

func Bytes2Size(num int64) string {
	numStr := ""
	unit := "B"
	if num/int64(sizeGB) > 1 {
		numStr = fmt.Sprintf("%.2f", float64(num)/float64(sizeGB))
		unit = "GB"
	} else if num/int64(sizeMB) > 1 {
		numStr = fmt.Sprintf("%d", int(float64(num)/float64(sizeMB)))
		unit = "MB"
	} else if num/int64(sizeKB) > 1 {
		numStr = fmt.Sprintf("%d", int(float64(num)/float64(sizeKB)))
		unit = "KB"
	} else {
		numStr = fmt.Sprintf("%d", num)
	}
	return numStr + " " + unit
}

func ParseSize(sizeStr string) (int64, error) {
	sizeStr = strings.TrimSpace(sizeStr)
	unitIndex := strings.IndexAny(sizeStr, "kKmMgG")
	if unitIndex == -1 {
		return strconv.ParseInt(sizeStr, 10, 64)
	}

	numStr := sizeStr[:unitIndex]
	num, err := strconv.ParseInt(numStr, 10, 64)
	if err != nil {
		return 0, err
	}

	unit := strings.ToUpper(sizeStr[unitIndex:])
	switch unit {
	case "K", "KB":
		return num * 1024, nil
	case "M", "MB":
		return num * 1024 * 1024, nil
	case "G", "GB":
		return num * 1024 * 1024 * 1024, nil
	default:
		return 0, nil
	}
}

func CalcElapsedTime(start time.Time) int64 {
	return time.Now().Sub(start).Milliseconds()
}

// IsValidPhone validates if the input is a valid phone number
// Supports international phone numbers in various formats
func IsValidPhone(phone string) bool {
	phone = regexp.MustCompile(`[\s\-\(\)]`).ReplaceAllString(phone, "")

	if phone == "" {
		return false
	}

	if strings.HasPrefix(phone, "+") {
		numPart := phone[1:]
		if regexp.MustCompile(`^\d{7,15}$`).MatchString(numPart) {
			return true
		}
	}

	if regexp.MustCompile(`^1[3-9]\d{9}$`).MatchString(phone) {
		return true
	}

	if regexp.MustCompile(`^\d{7,15}$`).MatchString(phone) {
		return true
	}

	return false
}

// IsValidEmail validates if the input is a valid email address
func IsValidEmail(email string) bool {
	// Simple email format validation
	match, _ := regexp.MatchString(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`, email)
	return match
}

func HasIntersection(a, b []int64) bool {
	if len(a) > len(b) {
		a, b = b, a
	}
	set := make(map[int64]struct{}, len(a))
	for _, v := range a {
		set[v] = struct{}{}
	}
	for _, v := range b {
		if _, ok := set[v]; ok {
			return true
		}
	}
	return false
}

func GetHost(u string) (string, error) {
	parsed, err := url.Parse(u)
	if err != nil {
		return "", err
	}

	host := parsed.Scheme + "://" + parsed.Host
	return host, nil
}

func StrInArray(str string, arr []string) bool {
	for _, v := range arr {
		if v == str {
			return true
		}
	}
	return false
}

func Int64InArray(i int64, arr []int64) bool {
	for _, v := range arr {
		if v == i {
			return true
		}
	}
	return false
}
