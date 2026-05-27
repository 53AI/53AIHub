package service

import (
	"github.com/53AI/53AIHub/common/adaptorregistry"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/songquanpeng/one-api/relay/adaptor"
)

func GetAdaptor(apiType int) adaptor.Adaptor {
	return adaptorregistry.GetAdaptor(apiType)
}

func SetCustomConfig(a *adaptor.Adaptor, customConfig *custom.CustomConfig) error {
	return adaptorregistry.SetCustomConfig(a, customConfig)
}

func GetCustomConfig(a *adaptor.Adaptor) *custom.CustomConfig {
	return adaptorregistry.GetCustomConfig(a)
}
