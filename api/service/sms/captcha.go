package sms

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"math/big"
	mathrand "math/rand"
	"strconv"
	"strings"
	"sync"
	"time"
	"errors"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	captchaKeyPrefix         = "Api:SMS:Captcha:"
	captchaAttemptsKeyPrefix = "Api:SMS:Captcha:Attempts:"
	captchaLength            = 4
)

var ErrCaptchaIPRateLimit = errors.New("captcha request rate limit exceeded")

// CheckCaptchaIPRateLimit 检查 IP 维度获取图形验证码频控（防刷图耗尽服务端 CPU）
func CheckCaptchaIPRateLimit(ip string) error {
	limit := config.SMS_CAPTCHA_IP_RATE_LIMIT
	if limit <= 0 {
		return nil
	}
	if !common.RedisEnabled || common.RDB == nil {
		return nil
	}

	bucket := ipBucketKey(ip)
	now := time.Now()
	key := fmt.Sprintf("Api:SMS:Captcha:IP:%s:%s", bucket, now.Format("200601021504"))
	count, err := common.RedisIncr(key)
	if err != nil {
		logger.SysError(fmt.Sprintf("Redis unavailable while checking captcha ip rate limit: %v", err))
		return nil
	}
	if count == 1 {
		_, _ = common.RedisExpire(key, 70*time.Second)
	}
	if count > int64(limit) {
		logger.SysWarnf("【短信告警】IP 段 %s 1分钟内获取图形验证码 %d 次，超过上限 %d，已拦截", bucket, count, limit)
		return ErrCaptchaIPRateLimit
	}
	return nil
}

// captchaChars 去掉易混淆字符（0/O/1/I/l 等）
var captchaChars = []rune("23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ")

// 深色系文字调色板（墨绿、暗紫、深蓝、深褐红、炭黑），与干扰曲线同色系破坏二值化
var captchaTextColors = []color.RGBA{
	{0x1A, 0x36, 0x5D, 0xFF}, // 深海蓝
	{0x2C, 0x1A, 0x4D, 0xFF}, // 深暗紫
	{0x1C, 0x45, 0x32, 0xFF}, // 墨绿
	{0x65, 0x1A, 0x1A, 0xFF}, // 深褐红
	{0x2D, 0x37, 0x48, 0xFF}, // 炭黑灰
}

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

func captchaTTL() time.Duration {
	sec := config.SMS_CAPTCHA_EXPIRE_SECONDS
	if sec <= 0 {
		sec = 120
	}
	return time.Duration(sec) * time.Second
}

func captchaMaxAttempts() int {
	max := config.SMS_CAPTCHA_MAX_ATTEMPTS
	if max <= 0 {
		max = 3
	}
	return max
}

type captchaChallenge struct {
	display string // 绘制到图片中的文字，如 "8+5=?" 或 "4x8k"
	answer  string // 验证答案（统一存小写），如 "13" 或 "4x8k"
}

// generateChallenge 生成题目：支持 4 位防混淆英数字符模式和算术题模式
func generateChallenge() (captchaChallenge, error) {
	mode := strings.ToLower(strings.TrimSpace(config.SMS_CAPTCHA_MODE))
	if mode == "math" {
		return generateMathChallenge()
	}
	return generateAlphaNumericChallenge()
}

func generateAlphaNumericChallenge() (captchaChallenge, error) {
	code := make([]rune, captchaLength)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(captchaChars))))
		if err != nil {
			return captchaChallenge{}, err
		}
		code[i] = captchaChars[n.Int64()]
	}
	str := string(code)
	return captchaChallenge{
		display: str,
		answer:  strings.ToLower(str),
	}, nil
}

func generateMathChallenge() (captchaChallenge, error) {
	// 随机选择运算符：0: 加法, 1: 减法, 2: 乘法
	opRand, err := rand.Int(rand.Reader, big.NewInt(3))
	if err != nil {
		return captchaChallenge{}, err
	}
	switch opRand.Int64() {
	case 0: // 加法: a (1~15) + b (1~15)
		aR, _ := rand.Int(rand.Reader, big.NewInt(15))
		bR, _ := rand.Int(rand.Reader, big.NewInt(15))
		a, b := int(aR.Int64())+1, int(bR.Int64())+1
		return captchaChallenge{
			display: fmt.Sprintf("%d+%d=?", a, b),
			answer:  strconv.Itoa(a + b),
		}, nil
	case 1: // 减法: a (5~25) - b (1~a)
		aR, _ := rand.Int(rand.Reader, big.NewInt(21))
		a := int(aR.Int64()) + 5
		bR, _ := rand.Int(rand.Reader, big.NewInt(int64(a)))
		b := int(bR.Int64()) + 1
		return captchaChallenge{
			display: fmt.Sprintf("%d-%d=?", a, b),
			answer:  strconv.Itoa(a - b),
		}, nil
	default: // 乘法: a (1~9) × b (1~9)
		aR, _ := rand.Int(rand.Reader, big.NewInt(9))
		bR, _ := rand.Int(rand.Reader, big.NewInt(9))
		a, b := int(aR.Int64())+1, int(bR.Int64())+1
		return captchaChallenge{
			display: fmt.Sprintf("%d×%d=?", a, b),
			answer:  strconv.Itoa(a * b),
		}, nil
	}
}

// GenerateCaptcha 生成字符验证码：返回 captchaID 与 base64 PNG（data URI），答案存 Redis
func GenerateCaptcha() (captchaID, imageBase64 string, err error) {
	challenge, err := generateChallenge()
	if err != nil {
		return "", "", err
	}

	img, err := renderCaptchaImage(challenge.display)
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
	if err := common.RedisSet(captchaKeyPrefix+captchaID, challenge.answer, captchaTTL()); err != nil {
		return "", "", err
	}

	return captchaID, "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// luaVerifyWithAttempts 原子校验 Lua 脚本：
// 1. 若 key 不存在/已过期，清理 attempts 并返回 0；
// 2. 若答案大小写不敏感匹配，删除 key 与 attempts 并返回 1（通过）；
// 3. 若不匹配，attempts 递增：
//    - 若达到最大重试上限 maxAttempts，原子删除 key 与 attempts 并返回 -1（熔断销毁）；
//    - 否则返回 0（保留继续重试）。
const luaVerifyWithAttempts = `
local key = KEYS[1]
local attemptsKey = KEYS[2]
local expected = ARGV[1]
local maxAttempts = tonumber(ARGV[2])

local stored = redis.call('get', key)
if not stored then
    redis.call('del', attemptsKey)
    return 0
end

if string.lower(stored) == string.lower(expected) then
    redis.call('del', key, attemptsKey)
    return 1
end

local attempts = redis.call('incr', attemptsKey)
if attempts == 1 then
    local ttl = redis.call('ttl', key)
    if ttl > 0 then
        redis.call('expire', attemptsKey, ttl)
    end
end

if attempts >= maxAttempts then
    redis.call('del', key, attemptsKey)
    return -1
end

return 0
`

// VerifyCaptcha 校验验证码（大小写不敏感，带试错熔断上限）：
// 校验成功时原子删除（防重放）；单验证码累计输错达到上限时立即销毁（防暴力枚举）
func VerifyCaptcha(captchaID, answer string) bool {
	cleanAnswer := strings.TrimSpace(answer)
	if captchaID == "" || cleanAnswer == "" {
		return false
	}
	if !common.RedisEnabled || common.RDB == nil {
		logger.SysError("Redis unavailable while verifying captcha")
		return false
	}

	key := captchaKeyPrefix + captchaID
	attemptsKey := captchaAttemptsKeyPrefix + captchaID
	maxAttempts := captchaMaxAttempts()

	ctx := context.Background()
	res, err := common.RDB.Eval(ctx, luaVerifyWithAttempts, []string{key, attemptsKey}, cleanAnswer, maxAttempts).Result()
	if err != nil {
		logger.SysLog(fmt.Sprintf("【诊断-验证码】captcha=%s 校验异常：失败（Redis 错误：%v）", captchaID, err))
		return false
	}

	var code int64
	if n, ok := res.(int64); ok {
		code = n
	} else {
		parsed, _ := strconv.ParseInt(fmt.Sprintf("%v", res), 10, 64)
		code = parsed
	}

	if code == 1 {
		logger.SysLog(fmt.Sprintf("【诊断-验证码】captcha=%s 提交答案=%s 匹配结果：通过（已销毁）", captchaID, strings.ToLower(cleanAnswer)))
		return true
	} else if code == -1 {
		logger.SysWarnf("【短信告警】captcha=%s 试错达到上限 %d 次，已原子熔断销毁（防暴力破解）", captchaID, maxAttempts)
		return false
	}

	logger.SysLog(fmt.Sprintf("【诊断-验证码】captcha=%s 提交答案=%s 匹配结果：未通过（保留重试）", captchaID, strings.ToLower(cleanAnswer)))
	return false
}

// renderCaptchaImage 强抗 OCR 图形渲染：
// 1. 动态浅色背景 + 同色系散斑；
// 2. 字符独立随机旋转（±25°）与轻微负间距搭接（阻止投影切词）；
// 3. 正弦波全图扭曲形变（破坏水平边缘基线）；
// 4. 多色字符 + 贝塞尔平滑干扰粗曲线（破坏简单二值化分割）。
func renderCaptchaImage(text string) (image.Image, error) {
	face, err := getCaptchaFace()
	if err != nil {
		return nil, err
	}

	const w, h = 132, 44
	baseImg := image.NewRGBA(image.Rect(0, 0, w, h))

	rng := mathrand.New(mathrand.NewSource(time.Now().UnixNano()))

	// 1. 柔和浅色背景
	bgR := uint8(240 + rng.Intn(10))
	bgG := uint8(242 + rng.Intn(10))
	bgB := uint8(246 + rng.Intn(10))
	draw.Draw(baseImg, baseImg.Bounds(), image.NewUniform(color.RGBA{bgR, bgG, bgB, 0xFF}), image.Point{}, draw.Src)

	// 2. 背景微网格噪点（160 个）
	for i := 0; i < 160; i++ {
		noiseColor := color.RGBA{
			uint8(140 + rng.Intn(60)),
			uint8(150 + rng.Intn(60)),
			uint8(160 + rng.Intn(60)),
			uint8(90 + rng.Intn(60)),
		}
		baseImg.Set(rng.Intn(w), rng.Intn(h), noiseColor)
	}

	// 3. 绘制贯穿贝塞尔干扰曲线（底层）
	drawBezierCurve(baseImg, rng, w, h)

	// 4. 逐字符绘制：独立旋转与负间距
	runes := []rune(text)
	n := len(runes)
	if n == 0 {
		return baseImg, nil
	}

	// 动态计算每个字符的起始与步长
	step := (w - 24) / n
	startX := 12
	if n > 4 {
		startX = 8
		step = (w - 16) / n
	}

	for i, ch := range runes {
		textColor := captchaTextColors[rng.Intn(len(captchaTextColors))]
		// 每个字符独立旋转角：-22° ~ +22°
		angleDeg := float64(rng.Intn(45) - 22)
		charImg := renderSingleChar(ch, face, textColor, angleDeg)

		// 字符绘制位置：微带 y 抖动与 x 负间距搭接
		targetX := startX + i*step + rng.Intn(3) - 1
		targetY := 4 + rng.Intn(5)
		drawRotatedChar(baseImg, charImg, targetX, targetY)
	}

	// 5. 顶层再绘制一条穿透贝塞尔曲线
	drawBezierCurve(baseImg, rng, w, h)

	// 6. 正弦波形变扭曲（破坏水平基准线与模板匹配）
	distortedImg := applySineWaveDistortion(baseImg, rng, w, h)
	return distortedImg, nil
}

// renderSingleChar 绘制单个带旋转角度的字符到临时图层
func renderSingleChar(ch rune, face font.Face, c color.RGBA, angleDeg float64) image.Image {
	const cw, chH = 34, 38
	src := image.NewRGBA(image.Rect(0, 0, cw, chH))

	d := &font.Drawer{
		Dst:  src,
		Src:  image.NewUniform(c),
		Face: face,
		Dot:  fixed.P(8, 28),
	}
	d.DrawString(string(ch))

	if math.Abs(angleDeg) < 1.0 {
		return src
	}

	// 中心旋转
	rad := angleDeg * math.Pi / 180.0
	cosA := math.Cos(rad)
	sinA := math.Sin(rad)
	cx, cy := float64(cw)/2.0, float64(chH)/2.0

	dst := image.NewRGBA(image.Rect(0, 0, cw, chH))
	for y := 0; y < chH; y++ {
		for x := 0; x < cw; x++ {
			// 逆变换求原坐标
			dx := float64(x) - cx
			dy := float64(y) - cy
			origX := int(math.Round(cx + dx*cosA + dy*sinA))
			origY := int(math.Round(cy - dx*sinA + dy*cosA))
			if origX >= 0 && origX < cw && origY >= 0 && origY < chH {
				col := src.RGBAAt(origX, origY)
				if col.A > 0 {
					dst.SetRGBA(x, y, col)
				}
			}
		}
	}
	return dst
}

// drawRotatedChar 将字符图层按 Alpha 混合绘制到主画布
func drawRotatedChar(dst *image.RGBA, charImg image.Image, x, y int) {
	bounds := charImg.Bounds()
	for cy := bounds.Min.Y; cy < bounds.Max.Y; cy++ {
		for cx := bounds.Min.X; cx < bounds.Max.X; cx++ {
			c := charImg.At(cx, cy)
			_, _, _, a := c.RGBA()
			if a > 0 {
				targetX := x + cx
				targetY := y + cy
				if targetX >= 0 && targetX < dst.Bounds().Dx() && targetY >= 0 && targetY < dst.Bounds().Dy() {
					// 简单 Alpha 覆盖混合
					if a >= 0x8000 {
						dst.Set(targetX, targetY, c)
					}
				}
			}
		}
	}
}

// applySineWaveDistortion 对整张图应用正弦波形变（破坏直线特征）
func applySineWaveDistortion(src *image.RGBA, rng *mathrand.Rand, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), src, image.Point{}, draw.Src)

	ampY := 1.8 + rng.Float64()*1.2       // 振幅 1.8~3.0px
	periodX := 28.0 + rng.Float64()*16.0 // 周期 28~44px
	phase := rng.Float64() * math.Pi * 2

	for x := 0; x < w; x++ {
		dy := int(math.Round(ampY * math.Sin(2*math.Pi*float64(x)/periodX+phase)))
		for y := 0; y < h; y++ {
			srcY := y + dy
			if srcY >= 0 && srcY < h {
				dst.Set(x, y, src.At(x, srcY))
			}
		}
	}
	return dst
}

// drawBezierCurve 绘制穿透平滑贝塞尔曲线
func drawBezierCurve(img *image.RGBA, rng *mathrand.Rand, w, h int) {
	curveColor := captchaTextColors[rng.Intn(len(captchaTextColors))]
	curveColor.A = uint8(140 + rng.Intn(70))

	p0x, p0y := float64(rng.Intn(15)), float64(rng.Intn(h))
	p1x, p1y := float64(w/2+rng.Intn(20)-10), float64(rng.Intn(h))
	p2x, p2y := float64(w-rng.Intn(15)), float64(rng.Intn(h))

	const steps = 70
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		u := 1 - t
		x := int(math.Round(u*u*p0x + 2*u*t*p1x + t*t*p2x))
		y := int(math.Round(u*u*p0y + 2*u*t*p1y + t*t*p2y))
		if x >= 0 && x < w && y >= 0 && y < h {
			img.Set(x, y, curveColor)
			// 线宽加粗 1 像素
			if y+1 < h {
				img.Set(x, y+1, curveColor)
			}
		}
	}
}
