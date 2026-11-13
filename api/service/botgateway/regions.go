package botgateway

// LoginRegion 扫码登录可选地区。
type LoginRegion struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	IsDefault bool   `json:"is_default,omitempty"`
}

// LoginRegionsResult 地区列表出参（按通道区分专属字段、提示与枚举）。
type LoginRegionsResult struct {
	Provider string        `json:"provider"`
	ParamKey string        `json:"param_key"` // 推荐入参字段名（企微 areaCode，个微 regionId）
	Hint     string        `json:"hint"`      // 针对前端用户的关键约束提示
	List     []LoginRegion `json:"list"`
}

// 企微官方标准行政区划（api-522631393 官方标准名称）
var wecomRegions = []LoginRegion{
	{Code: "110000", Name: "北京市"},
	{Code: "120000", Name: "天津市"},
	{Code: "130000", Name: "河北省"},
	{Code: "140000", Name: "山西省"},
	{Code: "150000", Name: "内蒙古自治区"},
	{Code: "210000", Name: "辽宁省"},
	{Code: "220000", Name: "吉林省"},
	{Code: "230000", Name: "黑龙江省"},
	{Code: "310000", Name: "上海市"},
	{Code: "320000", Name: "江苏省", IsDefault: true},
	{Code: "330000", Name: "浙江省"},
	{Code: "340000", Name: "安徽省"},
	{Code: "350000", Name: "福建省"},
	{Code: "360000", Name: "江西省"},
	{Code: "370000", Name: "山东省"},
	{Code: "410000", Name: "河南省"},
	{Code: "420000", Name: "湖北省"},
	{Code: "430000", Name: "湖南省"},
	{Code: "440000", Name: "广东省"},
	{Code: "450000", Name: "广西壮族自治区"},
	{Code: "460000", Name: "海南省"},
	{Code: "500000", Name: "重庆市"},
	{Code: "510000", Name: "四川省"},
	{Code: "520000", Name: "贵州省"},
	{Code: "530000", Name: "云南省"},
	{Code: "540000", Name: "西藏自治区"},
	{Code: "610000", Name: "陕西省"},
	{Code: "620000", Name: "甘肃省"},
	{Code: "630000", Name: "青海省"},
	{Code: "640000", Name: "宁夏回族自治区"},
	{Code: "650000", Name: "新疆维吾尔自治区"},
}

// 个微官方附录 A 地区代码表
var wechatRegions = []LoginRegion{
	{Code: "110000", Name: "北京"},
	{Code: "120000", Name: "天津"},
	{Code: "130000", Name: "河北"},
	{Code: "140000", Name: "山西"},
	{Code: "150000", Name: "内蒙古"},
	{Code: "210000", Name: "辽宁"},
	{Code: "220000", Name: "吉林"},
	{Code: "230000", Name: "黑龙江"},
	{Code: "310000", Name: "上海"},
	{Code: "320000", Name: "江苏", IsDefault: true},
	{Code: "330000", Name: "浙江"},
	{Code: "340000", Name: "安徽"},
	{Code: "350000", Name: "福建"},
	{Code: "360000", Name: "江西"},
	{Code: "370000", Name: "山东"},
	{Code: "410000", Name: "河南"},
	{Code: "420000", Name: "湖北"},
	{Code: "430000", Name: "湖南"},
	{Code: "440000", Name: "广东"},
	{Code: "450000", Name: "广西"},
	{Code: "460000", Name: "海南"},
	{Code: "500000", Name: "重庆"},
	{Code: "510000", Name: "四川"},
	{Code: "520000", Name: "贵州"},
	{Code: "530000", Name: "云南"},
	{Code: "540000", Name: "西藏"},
	{Code: "610000", Name: "陕西"},
	{Code: "620000", Name: "甘肃"},
	{Code: "630000", Name: "青海"},
	{Code: "640000", Name: "宁夏"},
	{Code: "650000", Name: "新疆"},
}

// GetLoginRegions 根据渠道类型（wework/wechat）返回对应专属地区配置与操作提示。
func GetLoginRegions(provider string) LoginRegionsResult {
	if provider == "wechat" {
		return LoginRegionsResult{
			Provider: "wechat",
			ParamKey: "region",
			Hint:     "个微 regionId 仅供测试使用；正式环境建议保持默认并在取码时传入专用的 proxy_ip 代理",
			List:     wechatRegions,
		}
	}
	return LoginRegionsResult{
		Provider: "wework",
		ParamKey: "region",
		Hint:     "企微 areaCode 必须与扫码手机端当前实际所在省份保持一致，切忌跨省以免触发平台封控",
		List:     wecomRegions,
	}
}

// LoginRegions 保持向前兼容旧无参调用（默认返回企微全量）。
func LoginRegions() []LoginRegion {
	return wecomRegions
}
