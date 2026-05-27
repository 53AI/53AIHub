package tools

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultWebFetchMaxChars     = 60000
	maxWebFetchBodyBytes        = 2 * 1024 * 1024
	maxWebFetchRedirects        = 3
	webFetchTimeoutSeconds      = 30
	defaultWebFetchExtractMode  = "markdown"
	webFetchDefaultUserAgent    = "Mozilla/5.0 (compatible; 53AIHub-WebFetch/1.0)"
	webFetchBinaryPreviewPrefix = "[Binary content omitted]"
)

var (
	htmlScriptStyleRe = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	htmlCommentRe     = regexp.MustCompile(`(?is)<!--.*?-->`)
	htmlTagRe         = regexp.MustCompile(`(?is)<[^>]+>`)
	spaceCollapseRe   = regexp.MustCompile(`[ \t\f\v]+`)
)

type webFetchResolver func(ctx context.Context, host string) ([]net.IP, error)
type webFetchDialer func(ctx context.Context, network, address string) (net.Conn, error)

var defaultWebFetchResolver webFetchResolver = func(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

func executeWebFetch(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	rawURL, ok := args["url"].(string)
	if !ok || strings.TrimSpace(rawURL) == "" {
		return nil, fmt.Errorf("missing url argument")
	}
	rawURL = strings.TrimSpace(rawURL)

	extractMode := defaultWebFetchExtractMode
	if mode, ok := args["extractMode"].(string); ok {
		mode = strings.TrimSpace(strings.ToLower(mode))
		if mode == "text" || mode == "markdown" {
			extractMode = mode
		}
	}

	maxChars := defaultWebFetchMaxChars
	if v, exists := args["maxChars"]; exists {
		maxChars = parseIntValue(v, defaultWebFetchMaxChars)
		if maxChars < 256 {
			maxChars = 256
		}
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("only http and https URLs are supported")
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return nil, fmt.Errorf("missing hostname in url")
	}

	proxyURL := webFetchProxyURLForRequest(parsed)
	proxyAware := proxyURL != nil
	if !proxyAware {
		if err := checkWebFetchSSRF(ctx, parsed.Hostname(), defaultWebFetchResolver); err != nil {
			return nil, err
		}
	}

	result, err := fetchWebContent(ctx, rawURL, proxyURL)
	if err != nil {
		return nil, err
	}

	content := result.Content
	if strings.Contains(result.ContentType, "text/html") {
		content = extractTextFromHTML(result.Content)
	}

	if !utf8.ValidString(content) {
		content = webFetchBinaryPreviewPrefix
	}
	if extractMode == "markdown" {
		content = normalizeWebFetchText(content)
	}

	truncated := false
	if len(content) > maxChars {
		content = content[:maxChars]
		truncated = true
	}
	content = strings.TrimSpace(content)
	if content == "" {
		content = "(No content extracted)"
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("URL: %s\n", result.FinalURL))
	output.WriteString(fmt.Sprintf("Status: %d\n", result.StatusCode))
	output.WriteString(fmt.Sprintf("Content-Type: %s\n\n", result.ContentType))
	output.WriteString(content)
	if truncated {
		output.WriteString(fmt.Sprintf("\n\n[Truncated to %d characters]", maxChars))
	}

	return &ToolResult{
		Output:   output.String(),
		ExitCode: 0,
	}, nil
}

type webFetchResult struct {
	FinalURL    string
	StatusCode  int
	ContentType string
	Content     string
}

func fetchWebContent(ctx context.Context, rawURL string, proxyURL *url.URL) (*webFetchResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("User-Agent", webFetchDefaultUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/json,text/plain,*/*")

	redirectCount := 0
	baseDialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	transport := &http.Transport{
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if proxyURL != nil {
		transport.Proxy = http.ProxyURL(proxyURL)
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}
	if proxyURL == nil {
		transport.DialContext = buildWebFetchDialContext(defaultWebFetchResolver, baseDialer.DialContext)
	}
	client := &http.Client{
		Timeout:   webFetchTimeoutSeconds * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			redirectCount++
			if redirectCount > maxWebFetchRedirects {
				return fmt.Errorf("too many redirects (>%d)", maxWebFetchRedirects)
			}
			if proxyURL != nil {
				return nil
			}
			return checkWebFetchSSRF(req.Context(), req.URL.Hostname(), defaultWebFetchResolver)
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxWebFetchBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("read response failed: %w", err)
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	content := string(body)

	if resp.StatusCode >= http.StatusBadRequest {
		msg := strings.TrimSpace(content)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		if msg == "" {
			msg = http.StatusText(resp.StatusCode)
		}
		return nil, fmt.Errorf("remote server returned %d: %s", resp.StatusCode, msg)
	}

	return &webFetchResult{
		FinalURL:    resp.Request.URL.String(),
		StatusCode:  resp.StatusCode,
		ContentType: contentType,
		Content:     content,
	}, nil
}

func webFetchProxyURLForRequest(parsed *url.URL) *url.URL {
	if parsed == nil {
		return nil
	}

	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" {
		return nil
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || isPrivateOrLocalHostname(host) {
		return nil
	}
	if noProxyMatches(host) {
		return nil
	}

	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	candidates := []string{}
	if scheme == "https" {
		candidates = append(candidates, os.Getenv("HTTPS_PROXY"), os.Getenv("https_proxy"))
	}
	candidates = append(candidates, os.Getenv("HTTP_PROXY"), os.Getenv("http_proxy"))

	for _, raw := range candidates {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		proxyURL, err := url.Parse(raw)
		if err != nil || proxyURL == nil {
			continue
		}
		return proxyURL
	}
	return nil
}

func webFetchProxyEnabledForURL(parsed *url.URL) bool {
	return webFetchProxyURLForRequest(parsed) != nil
}

func noProxyMatches(host string) bool {
	raw := strings.TrimSpace(os.Getenv("NO_PROXY"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("no_proxy"))
	}
	if raw == "" {
		return false
	}
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(strings.ToLower(item))
		if item == "" {
			continue
		}
		if item == "*" {
			return true
		}
		if host == item || strings.HasSuffix(host, "."+item) {
			return true
		}
	}
	return false
}

func isPrivateOrLocalHostname(host string) bool {
	if host == "" {
		return true
	}
	if host == "127.0.0.1" || host == "::1" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPrivateOrLocalIP(ip)
	}
	return false
}

func extractTextFromHTML(raw string) string {
	s := htmlScriptStyleRe.ReplaceAllString(raw, " ")
	s = htmlCommentRe.ReplaceAllString(s, " ")
	s = htmlTagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	return normalizeWebFetchText(s)
}

func normalizeWebFetchText(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")

	var out bytes.Buffer
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(spaceCollapseRe.ReplaceAllString(line, " "))
		if line == "" {
			continue
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	return strings.TrimSpace(out.String())
}

func buildWebFetchDialContext(resolver webFetchResolver, dialer webFetchDialer) webFetchDialer {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			host = address
			port = "80"
		}
		ip, err := resolveAndPickPublicIP(ctx, host, resolver)
		if err != nil {
			return nil, err
		}
		return dialer(ctx, network, net.JoinHostPort(ip.String(), port))
	}
}

func checkWebFetchSSRF(ctx context.Context, hostname string, resolver webFetchResolver) error {
	_, err := resolveAndPickPublicIP(ctx, hostname, resolver)
	return err
}

func resolveAndPickPublicIP(ctx context.Context, hostname string, resolver webFetchResolver) (net.IP, error) {
	hostname = strings.TrimSpace(strings.ToLower(hostname))
	if hostname == "" {
		return nil, fmt.Errorf("empty hostname")
	}
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return nil, fmt.Errorf("SSRF protection: localhost is not allowed")
	}

	if parsedIP := net.ParseIP(hostname); parsedIP != nil {
		if isPrivateOrLocalIP(parsedIP) {
			return nil, fmt.Errorf("SSRF protection: private/local address is not allowed (%s)", parsedIP.String())
		}
		return parsedIP, nil
	}

	if resolver == nil {
		resolver = defaultWebFetchResolver
	}
	ips, err := resolver(ctx, hostname)
	if err != nil {
		return nil, fmt.Errorf("resolve host failed: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("resolve host failed: no ip found")
	}
	var firstAllowed net.IP
	for _, ip := range ips {
		if !isPrivateOrLocalIP(ip) {
			firstAllowed = ip
			break
		}
	}
	if firstAllowed == nil {
		return nil, fmt.Errorf("SSRF protection: private/local address is not allowed")
	}
	return firstAllowed, nil
}

func isPrivateOrLocalIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 10:
			return true
		case v4[0] == 127:
			return true
		case v4[0] == 169 && v4[1] == 254:
			return true
		case v4[0] == 172 && v4[1] >= 16 && v4[1] <= 31:
			return true
		case v4[0] == 192 && v4[1] == 168:
			return true
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127:
			return true
		case v4[0] == 0:
			return true
		default:
			return false
		}
	}

	// IPv6 unique-local fc00::/7
	if len(ip) == net.IPv6len && ip[0]&0xfe == 0xfc {
		return true
	}
	// IPv6 link-local fe80::/10
	if len(ip) == net.IPv6len && ip[0] == 0xfe && ip[1]&0xc0 == 0x80 {
		return true
	}

	return false
}
