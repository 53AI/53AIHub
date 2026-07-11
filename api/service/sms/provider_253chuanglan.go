package sms

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// ChuanglanProvider 创蓝短信提供商实现
type ChuanglanProvider struct {
	account    string
	password   string
	signName   string
	template   string
	apiURL     string
	needStatus int
}

// NewChuanglanProvider 创建创蓝提供商实例
func NewChuanglanProvider(account, password, signName, template string) SMSProvider {
	return &ChuanglanProvider{
		account:    account,
		password:   password,
		signName:   signName,
		template:   template,
		apiURL:     "http://sms.253.com/msg/send",
		needStatus: 0,
	}
}

// GetName 获取提供商名称
func (c *ChuanglanProvider) GetName() string {
	return "253chuanglan"
}

// Send 发送短信验证码
// 模板: "{sign}您的验证码为：{vcode}，15分钟内有效，请勿泄露于他人！"
func (c *ChuanglanProvider) Send(mobile string, code string) error {
	// 使用配置的模板，为空则用代码兜底
	tpl := c.template
	if tpl == "" {
		tpl = "【%s】您的验证码为：%s，15分钟内有效，请勿泄露于他人！"
	}
	message := fmt.Sprintf(tpl, c.signName, code)

	// 构建POST数据
	data := url.Values{}
	data.Set("un", c.account)
	data.Set("pw", c.password)
	data.Set("msg", message)
	data.Set("phone", mobile)
	data.Set("rd", fmt.Sprintf("%d", c.needStatus))

	postStr := data.Encode()

	// 创建HTTP请求
	req, err := http.NewRequest("POST", c.apiURL, strings.NewReader(postStr))
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to create request for SMS: %v", err))
		return fmt.Errorf("failed to create HTTP request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")

	// 发送请求
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to send SMS request: %v", err))
		return fmt.Errorf("failed to send HTTP request: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to read SMS response: %v", err))
		return fmt.Errorf("failed to read response: %w", err)
	}

	// 解析响应
	if !c.isSuccessResponse(string(body)) {
		logger.SysError(fmt.Sprintf("SMS API returned error: %s for mobile: %s", string(body), mobile))
		return fmt.Errorf("SMS API error: %s", string(body))
	}

	logger.SysLog(fmt.Sprintf("SMS sent successfully to %s via 253chuanglan", mobile))
	return nil
}

// isSuccessResponse 检查响应是否成功
// 创蓝接口返回格式:
// 第一行: "20150826163033,0" (时间戳,状态码)
// 第二行: "批次编号" (可选，如果存在则表示成功发送)
// 状态码为0表示成功，如果有第二行的批次编号则进一步确认成功
func (c *ChuanglanProvider) isSuccessResponse(response string) bool {
	if response == "" {
		return false
	}

	// 按行分割响应
	lines := strings.Split(strings.TrimSpace(response), "\n")
	if len(lines) == 0 {
		return false
	}

	// 解析第一行：时间戳,状态码
	firstLine := strings.TrimSpace(lines[0])
	parts := strings.Split(firstLine, ",")

	if len(parts) < 2 {
		return false
	}

	// 检查状态码（第二部分）是否为0
	statusCode := strings.TrimSpace(parts[1])
	if statusCode != "0" {
		return false
	}

	// 如果返回值有多行且状态码为0，说明发送成功
	// 第二行通常是批次编号，表示确实发送成功
	if len(lines) > 1 {
		batchID := strings.TrimSpace(lines[1])
		if batchID != "" {
			// 批次号不为空，说明发送成功
			logger.SysLog(fmt.Sprintf("SMS batch ID: %s", batchID))
			return true
		}
	}

	// 只有一行且状态码为0也认为成功
	return statusCode == "0"
}
