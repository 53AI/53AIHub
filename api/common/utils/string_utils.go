package utils

import (
	"net/url"
	"unicode"
	"unicode/utf8"
)

// CountCharacters 计算字符串的字符数（支持中文字符，一个中文算一个字符）
func CountCharacters(text string) int {
	return utf8.RuneCountInString(text)
}

// CountChineseCharacters 计算中文字符数
func CountChineseCharacters(text string) int {
	count := 0
	for _, r := range text {
		if isCJK(r) {
			count++
		}
	}
	return count
}

// CountEnglishCharacters 计算英文字母数
func CountEnglishCharacters(text string) int {
	count := 0
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			count++
		}
	}
	return count
}

// CountNonSpaceCharacters 计算非空格字符数
func CountNonSpaceCharacters(text string) int {
	count := 0
	for _, r := range text {
		if !unicode.IsSpace(r) {
			count++
		}
	}
	return count
}

// isCJK 判断是否为中日韩字符
func isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
		(r >= 0x3400 && r <= 0x4DBF) || // CJK Extension A
		(r >= 0x20000 && r <= 0x2A6DF) || // CJK Extension B
		(r >= 0x2A700 && r <= 0x2B73F) || // CJK Extension C
		(r >= 0x2B740 && r <= 0x2B81F) || // CJK Extension D
		(r >= 0x2B820 && r <= 0x2CEAF) || // CJK Extension E
		(r >= 0xF900 && r <= 0xFAFF) || // CJK Compatibility Ideographs
		(r >= 0x2F800 && r <= 0x2FA1F) // CJK Compatibility Supplement
}

// IsURL checks if a string is a valid URL with a scheme and host
func IsURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && u.Host != ""
}
