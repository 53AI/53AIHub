package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

type skillLibraryLLMInvoker interface {
	CallChatCompletion(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error)
}

type skillLibraryLLMInvokerFunc func(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error)

func (f skillLibraryLLMInvokerFunc) CallChatCompletion(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error) {
	return f(ctx, channel, request)
}

type defaultSkillLibraryLLMInvoker struct {
	contentService *rag.ContentGeneratorService
}

func (c *defaultSkillLibraryLLMInvoker) CallChatCompletion(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error) {
	if c == nil || c.contentService == nil {
		return "", fmt.Errorf("skill library llm caller is not initialized"), nil
	}
	if request != nil {
		request.Stream = false
	}
	return c.contentService.TestChannel(ctx, channel, request)
}

func newDefaultSkillLibraryLLMInvoker() skillLibraryLLMInvoker {
	return &defaultSkillLibraryLLMInvoker{
		contentService: rag.NewContentGeneratorService(model.DB),
	}
}

func invokeSkillLibraryLLMWithInvoker(ctx context.Context, invoker skillLibraryLLMInvoker, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error) {
	if request == nil {
		return "", fmt.Errorf("skill library llm request is nil"), nil
	}
	request.Stream = false
	if invoker == nil {
		return "", fmt.Errorf("skill library llm invoker is nil"), nil
	}
	return invoker.CallChatCompletion(ctx, channel, request)
}
