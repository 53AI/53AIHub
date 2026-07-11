package custom

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/relay/adaptor"
	"github.com/songquanpeng/one-api/relay/meta"
)

func SetupCommonRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) {
	req.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	req.Header.Set("Accept", c.Request.Header.Get("Accept"))
	if meta.IsStream && c.Request.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "text/event-stream")
	}
}

func DoRequestHelper(a adaptor.Adaptor, c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	// 先读取并保存请求体内容
	var bodyBytes []byte
	var err error
	if requestBody != nil {
		bodyBytes, err = io.ReadAll(requestBody)
		if err != nil {
			return nil, fmt.Errorf("read request body failed: %w", err)
		}
		// 重新创建requestBody供后续使用
		requestBody = bytes.NewReader(bodyBytes)
	}

	fullRequestURL, err := a.GetRequestURL(meta)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}
	req, err := http.NewRequest(c.Request.Method, fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}
	err = a.SetupRequestHeader(c, req, meta)
	if err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}
	resp, err := DoRequest(c, req)
	if err != nil {
		return nil, fmt.Errorf("do request failed: %w", err)
	}

	if config.DebugEnabled {
		var bodyStr string
		if len(bodyBytes) > 0 {
			bodyStr = string(bodyBytes)
			// 尝试将bodyStr格式化为更易读的JSON
			var jsonBody interface{}
			if json.Unmarshal(bodyBytes, &jsonBody) == nil {
				if prettyJSON, err := json.MarshalIndent(jsonBody, "", "  "); err == nil {
					bodyStr = string(prettyJSON)
				}
			}
		} else {
			bodyStr = "<empty>"
		}

		logger.SysDebugf("\n=== DEBUG REQUEST ===\n"+
			"URL: %s\n"+
			"Method: %s\n"+
			"Headers: %v\n"+
			"Body: \n%s\n"+
			"====================",
			fullRequestURL,
			c.Request.Method,
			req.Header,
			bodyStr,
		)
	}
	return resp, nil
}

func DoRequest(c *gin.Context, req *http.Request) (*http.Response, error) {
	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, errors.New("resp is nil")
	}
	_ = req.Body.Close()
	_ = c.Request.Body.Close()
	return resp, nil
}

func GetBaseURL(baseUrl string) (string, error) {
	baseUrl, err := helper.GetHost(baseUrl)
	if err != nil {
		return "", errors.New("invalid base url: " + baseUrl)
	}
	baseUrl = strings.TrimSuffix(baseUrl, "/")
	return baseUrl, nil
}
