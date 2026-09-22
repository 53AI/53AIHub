package sms

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/big"
	mathrand "math/rand"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	captchaKeyPrefix = "Api:SMS:Captcha:"
	captchaTTL       = 5 * time.Minute
	captchaLength    = 4
)

// captchaChars 去掉易混淆字符（0/O/1/I/l 等）
var captchaChars = []rune("23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ")

var (
	captchaFaceOnce sync.Once
	captchaFaceVal  font.Face
	captchaFaceErr  error
)

func getCaptchaFace() (font.Face, error) {
	captchaFaceOnce.Do(func() {
		f, err := opentype.Parse(goregular.TTF)
		if err != nil {
			captchaFaceErr = err
			return
		}
		captchaFaceVal, captchaFaceErr = opentype.NewFace(f, &opentype.FaceOptions{Size: 26, DPI: 72})
	})
	return captchaFaceVal, captchaFaceErr
}

// GenerateCaptcha 生成字符验证码：返回 captchaID 与 base64 PNG（data URI），答案存 Redis 一次性（5 分钟有效）
func GenerateCaptcha() (captchaID, imageBase64 string, err error) {
	code := make([]rune, captchaLength)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(captchaChars))))
		if err != nil {
			return "", "", err
		}
		code[i] = captchaChars[n.Int64()]
	}

	img, err := renderCaptchaImage(string(code))
	if err != nil {
		return "", "", err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", "", err
	}

	idBytes := make([]byte, 8)
	_, _ = rand.Read(idBytes)
	captchaID = fmt.Sprintf("%x", idBytes)
	if err := common.RedisSet(captchaKeyPrefix+captchaID, strings.ToLower(string(code)), captchaTTL); err != nil {
		return "", "", err
	}

	return captchaID, "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// VerifyCaptcha 校验验证码（大小写不敏感）；
// 校验失败时不删除（保留到验证通过或缓存过期）；校验成功时原子删除（防重放）
func VerifyCaptcha(captchaID, answer string) bool {
	cleanAnswer := strings.TrimSpace(answer)
	if captchaID == "" || cleanAnswer == "" {
		return false
	}
	key := captchaKeyPrefix + captchaID
	matched, err := common.RedisCompareAndDelCaseInsensitive(key, cleanAnswer)
	if err != nil {
		logger.SysLog(fmt.Sprintf("【诊断-验证码】captcha=%s 校验异常：失败（Redis 错误：%v）", captchaID, err))
		return false // 不存在/过期/已被消费/Redis 异常均视为失败
	}
	logger.SysLog(fmt.Sprintf("【诊断-验证码】captcha=%s 提交答案=%s 匹配结果：%t", captchaID, strings.ToLower(cleanAnswer), matched))
	return matched
}

func renderCaptchaImage(code string) (image.Image, error) {
	face, err := getCaptchaFace()
	if err != nil {
		return nil, err
	}

	const w, h = 132, 44
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{0xF0, 0xF4, 0xF8, 0xFF}), image.Point{}, draw.Src)

	// 干扰线 + 噪点
	rng := mathrand.New(mathrand.NewSource(time.Now().UnixNano()))
	for i := 0; i < 5; i++ {
		x1, y1 := rng.Intn(w), rng.Intn(h)
		x2, y2 := rng.Intn(w), rng.Intn(h)
		drawLine(img, x1, y1, x2, y2, color.RGBA{0x99, 0xAA, 0xBB, 0x66})
	}
	for i := 0; i < 120; i++ {
		img.Set(rng.Intn(w), rng.Intn(h), color.RGBA{0x88, 0x99, 0xAA, 0x77})
	}

	// 逐字符绘制，带轻微 y 抖动
	d := &font.Drawer{Dst: img, Src: image.NewUniform(color.RGBA{0x22, 0x33, 0x44, 0xFF}), Face: face}
	x := 10
	for _, ch := range code {
		d.Dot = fixed.P(x, 28+rng.Intn(6))
		d.DrawString(string(ch))
		x += 26
	}
	return img, nil
}

// drawLine 简单 Bresenham 直线
func drawLine(img *image.RGBA, x1, y1, x2, y2 int, c color.Color) {
	dx := abs(x2 - x1)
	dy := -abs(y2 - y1)
	sx, sy := 1, 1
	if x1 > x2 {
		sx = -1
	}
	if y1 > y2 {
		sy = -1
	}
	err := dx + dy
	for {
		img.Set(x1, y1, c)
		if x1 == x2 && y1 == y2 {
			break
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x1 += sx
		}
		if e2 <= dx {
			err += dx
			y1 += sy
		}
	}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
