package custom

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

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
	requestBodySize := -1
	if sized, ok := requestBody.(interface{ Len() int }); ok {
		requestBodySize = sized.Len()
	}

	fullRequestURL, err := a.GetRequestURL(meta)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}
	req, err := newUpstreamRequest(c, c.Request.Method, fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}
	err = a.SetupRequestHeader(c, req, meta)
	if err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}
	requestStartedAt := time.Now()
	resp, err := doRequest(c, req, meta.IsStream)
	if err != nil {
		return nil, fmt.Errorf("do request failed: %w", err)
	}

	if config.DebugEnabled {
		logger.Debugf(c.Request.Context(), "LLM upstream request: url=%s method=%s status=%d duration_ms=%d model=%s stream=%t request_bytes=%d headers={%s}",
			logger.SanitizeURL(fullRequestURL),
			c.Request.Method,
			resp.StatusCode,
			time.Since(requestStartedAt).Milliseconds(),
			meta.ActualModelName,
			meta.IsStream,
			requestBodySize,
			logger.SanitizeHeaders(req.Header),
		)
	}
	return resp, nil
}

func newUpstreamRequest(c *gin.Context, method string, requestURL string, body io.Reader) (*http.Request, error) {
	return http.NewRequestWithContext(c.Request.Context(), method, requestURL, body)
}

func httpClientForRequest(requestCtx context.Context, isStream bool) (*http.Client, error) {
	httpClient := client.HTTPClient
	if httpClient == nil {
		return nil, errors.New("HTTP client is nil")
	}
	if !isStream {
		return httpClient, nil
	}
	if requestCtx == nil {
		return httpClient, nil
	}
	if _, hasDeadline := requestCtx.Deadline(); !hasDeadline {
		return httpClient, nil
	}

	// http.Client.Timeout covers the entire exchange, including reading a
	// streaming response body. Use a request-scoped copy so long-running streams
	// are governed by the execution context without mutating the shared client.
	streamClient := *httpClient
	streamClient.Timeout = 0
	return &streamClient, nil
}

func DoRequest(c *gin.Context, req *http.Request) (*http.Response, error) {
	return doRequest(c, req, false)
}

func doRequest(c *gin.Context, req *http.Request, isStream bool) (*http.Response, error) {
	httpClient, err := httpClientForRequest(req.Context(), isStream)
	if err != nil {
		return nil, err
	}
	resp, err := httpClient.Do(req)
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
