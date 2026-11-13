package common

import "regexp"

// internalContactCommentPattern 匹配转写正文中内嵌的私有人员元信息注释。
// 形如 <!--contact:{"id":"pEr001"}-->，由「发言人绑定人员」写入 FileBody。
var internalContactCommentPattern = regexp.MustCompile(`<!--contact:.*?-->`)

// StripInternalContactComments 剥除转写正文中的私有人员隐藏注释。
// 仅用于「非转写展示」的下游消费：RAG 分块/向量化、文件预览、导出与匿名分享，
// 避免私有人员 ID 进入检索索引、模型上下文或对外可见内容。
// 转写展示接口需保留该注释，请勿在此路径调用。
func StripInternalContactComments(text string) string {
	if text == "" {
		return ""
	}
	return internalContactCommentPattern.ReplaceAllString(text, "")
}
