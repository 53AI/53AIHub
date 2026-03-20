package openai

import (
	"github.com/songquanpeng/one-api/relay/adaptor/ai360"
	"github.com/songquanpeng/one-api/relay/adaptor/baichuan"
	"github.com/songquanpeng/one-api/relay/adaptor/deepseek"
	"github.com/songquanpeng/one-api/relay/adaptor/doubao"
	"github.com/songquanpeng/one-api/relay/adaptor/groq"
	"github.com/songquanpeng/one-api/relay/adaptor/lingyiwanwu"
	"github.com/songquanpeng/one-api/relay/adaptor/mistral"
	"github.com/songquanpeng/one-api/relay/adaptor/moonshot"
	"github.com/songquanpeng/one-api/relay/adaptor/novita"
	"github.com/songquanpeng/one-api/relay/adaptor/siliconflow"
	"github.com/songquanpeng/one-api/relay/adaptor/stepfun"
	"github.com/songquanpeng/one-api/relay/adaptor/togetherai"
	"github.com/songquanpeng/one-api/relay/adaptor/xai"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

// MiniMaxModelList contains the current MiniMax model IDs.
// The upstream one-api dependency (v0.6.10) only includes legacy abab* models
// which use the deprecated /v1/text/chatcompletion_v2 endpoint.
// MiniMax now provides an OpenAI-compatible API at api.minimax.io/v1 with
// the M2.7 series models. We override the model list here to reflect the
// latest available models while keeping backward compatibility with abab.
var MiniMaxModelList = []string{
	"MiniMax-M2.7",
	"MiniMax-M2.7-highspeed",
	"abab6.5-chat",
	"abab6.5s-chat",
	"abab6-chat",
	"abab5.5-chat",
	"abab5.5s-chat",
}

var CompatibleChannels = []int{
	channeltype.Azure,
	channeltype.AI360,
	channeltype.Moonshot,
	channeltype.Baichuan,
	channeltype.Minimax,
	channeltype.Doubao,
	channeltype.Mistral,
	channeltype.Groq,
	channeltype.LingYiWanWu,
	channeltype.StepFun,
	channeltype.DeepSeek,
	channeltype.TogetherAI,
	channeltype.Novita,
	channeltype.SiliconFlow,
	channeltype.XAI,
}

func GetCompatibleChannelMeta(channelType int) (string, []string) {
	switch channelType {
	case channeltype.Azure:
		return "azure", ModelList
	case channeltype.AI360:
		return "360", ai360.ModelList
	case channeltype.Moonshot:
		return "moonshot", moonshot.ModelList
	case channeltype.Baichuan:
		return "baichuan", baichuan.ModelList
	case channeltype.Minimax:
		return "minimax", MiniMaxModelList
	case channeltype.Mistral:
		return "mistralai", mistral.ModelList
	case channeltype.Groq:
		return "groq", groq.ModelList
	case channeltype.LingYiWanWu:
		return "lingyiwanwu", lingyiwanwu.ModelList
	case channeltype.StepFun:
		return "stepfun", stepfun.ModelList
	case channeltype.DeepSeek:
		return "deepseek", deepseek.ModelList
	case channeltype.TogetherAI:
		return "together.ai", togetherai.ModelList
	case channeltype.Doubao:
		return "doubao", doubao.ModelList
	case channeltype.Novita:
		return "novita", novita.ModelList
	case channeltype.SiliconFlow:
		return "siliconflow", siliconflow.ModelList
	case channeltype.XAI:
		return "xai", xai.ModelList
	default:
		return "openai", ModelList
	}
}
