package sms

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// ChuanglanV2Provider 创蓝短信v2版本提供商实现
type ChuanglanV2Provider struct {
	account    string
	password   string
	signName   string
	templateID string
	apiURL     string
}

// NewChuanglanV2Provider 创建创蓝v2版本提供商实例
func NewChuanglanV2Provider(account, password, signName, templateID string) SMSProvider {
	return &ChuanglanV2Provider{
		account:    account,
		password:   password,
		signName:   signName,
		templateID: templateID,
		apiURL:     "https://smssh.253.com/msg/sms/v2/tpl/send",
	}
}

// GetName 获取提供商名称
func (c *ChuanglanV2Provider) GetName() string {
	return "253chuanglanV2"
}

// Send 发送短信验证码 (v2版本)
// v2版本使用模板方式发送，需要配置模板ID和签名
func (c *ChuanglanV2Provider) Send(mobile string, code string) error {
	// 生成时间戳和nonce
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := c.generateNonce()

	// 构建请求体
	templateParamJSON := []map[string]string{
		{
			"param1": code,
		},
	}

	paramBytes, err := json.Marshal(templateParamJSON)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to marshal template params: %v", err))
		return fmt.Errorf("failed to marshal template params: %w", err)
	}

	requestBody := map[string]interface{}{
		"account":           c.account,
		"timestamp":         timestamp,
		"nonce":             nonce,
		"phoneNumbers":      mobile,
		"templateId":        c.templateID,
		"templateParamJson": string(paramBytes),
		"signature":         c.signName,
		"report":            "true",
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to marshal request body: %v", err))
		return fmt.Errorf("failed to marshal request body: %w", err)
	}

	// 生成签名
	md5Password := c.getMD5Password()
	signature := c.makeSignature(md5Password, timestamp, nonce)

	// 创建HTTP请求
	req, err := http.NewRequest("POST", c.apiURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to create request for SMS: %v", err))
		return fmt.Errorf("failed to create HTTP request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-QA-Hmac-Signature", signature)

	// 发送请求
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to send SMS request: %v", err))
		return fmt.Errorf("failed to send HTTP request: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to read SMS response: %v", err))
		return fmt.Errorf("failed to read response: %w", err)
	}

	// 解析响应
	var response ChuanglanV2Response
	if err := json.Unmarshal(respBody, &response); err != nil {
		logger.SysError(fmt.Sprintf("Failed to parse SMS response: %v, body: %s", err, string(respBody)))
		return fmt.Errorf("failed to parse response: %w", err)
	}

	// 检查响应状态
	if response.Code != "000000" {
		logger.SysError(fmt.Sprintf("SMS API returned error code: %s, message: %s for mobile: %s", response.Code, response.ErrorMsg, mobile))
		return fmt.Errorf("SMS API error: code=%s, msg=%s", response.Code, response.ErrorMsg)
	}

	logger.SysLog(fmt.Sprintf("SMS sent successfully to %s via 253chuanglanV2, msgId: %s", mobile, response.MsgID))
	return nil
}

// getMD5Password 获取密码的MD5值（32位小写）
func (c *ChuanglanV2Provider) getMD5Password() string {
	hash := md5.Sum([]byte(c.password))
	return hex.EncodeToString(hash[:])
}

// makeSignature 生成HmacSHA256签名
// 根据MD5密码、时间戳和nonce生成签名
// 算法：
// 1. 将md5Password、timestamp、nonce排序
// 2. 拼接排序后的字符串
// 3. 使用md5Password作为密钥，对拼接字符串进行HmacSHA256加密
func (c *ChuanglanV2Provider) makeSignature(md5Password, timestamp, nonce string) string {
	// 创建数组进行排序
	arr := []string{md5Password, timestamp, nonce}
	sort.Strings(arr)

	// 拼接排序后的字符串
	sortedStr := strings.Join(arr, "")

	// 生成HmacSHA256签名
	h := hmac.New(sha256.New, []byte(md5Password))
	h.Write([]byte(sortedStr))

	return hex.EncodeToString(h.Sum(nil))
}

// generateNonce 生成32位随机nonce字符串
func (c *ChuanglanV2Provider) generateNonce() string {
	// 使用当前时间戳和一个简单的随机生成方式
	// 在生产环境中，建议使用crypto/rand生成更安全的随机数
	h := md5.Sum([]byte(fmt.Sprintf("%d%d", time.Now().Unix(), time.Now().Nanosecond())))
	return hex.EncodeToString(h[:])
}

// ChuanglanV2Response v2版本API响应结构
type ChuanglanV2Response struct {
	Code       string `json:"code"`        // 提交响应状态码，返回"000000"表示成功
	MsgID      string `json:"msgId"`       // 消息ID (32位纯数字)
	Time       string `json:"time"`        // 响应时间
	SuccessNum string `json:"successNum"` // 提交成功数量
	FailNum    string `json:"failNum"`    // 提交失败数量
	ErrorMsg   string `json:"errorMsg"`   // 状态码中文说明
}
