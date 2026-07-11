package env

import (
	"os"
	"strconv"
	"strings"

	_ "github.com/joho/godotenv/autoload"
)

func Int(env string, defaultValue int) int {
	if env == "" || os.Getenv(env) == "" {
		return defaultValue
	}
	num, err := strconv.Atoi(os.Getenv(env))
	if err != nil {
		return defaultValue
	}
	return num
}

func Int64(env string, defaultValue int64) int64 {
	if env == "" || os.Getenv(env) == "" {
		return defaultValue
	}
	num, err := strconv.ParseInt(os.Getenv(env), 10, 64)
	if err != nil {
		return defaultValue
	}
	return num
}

func Float64(env string, defaultValue float64) float64 {
	if env == "" || os.Getenv(env) == "" {
		return defaultValue
	}
	num, err := strconv.ParseFloat(os.Getenv(env), 64)
	if err != nil {
		return defaultValue
	}
	return num
}

func String(env string, defaultValue string) string {
	if env == "" || os.Getenv(env) == "" {
		return defaultValue
	}
	return os.Getenv(env)
}

func Bool(env string, defaultValue bool) bool {
	if env == "" || os.Getenv(env) == "" {
		return defaultValue
	}
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(env)))
	if err != nil {
		return defaultValue
	}
	return value
}
