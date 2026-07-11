package sandboxruntime

import (
	"context"
	"fmt"
)

type Factory struct {
	cfg      ProviderConfig
	registry *Registry
}

func NewFactory(cfg ProviderConfig) *Factory {
	return &Factory{
		cfg:      cfg,
		registry: defaultRegistry,
	}
}

func NewFactoryFromConfig(cfg ProviderConfig) *Factory {
	return NewFactory(cfg)
}

func (f *Factory) New(ctx context.Context) (Runtime, error) {
	if f == nil {
		return nil, fmt.Errorf("runtime factory is nil")
	}
	if f.registry == nil {
		f.registry = defaultRegistry
	}
	return f.registry.New(ctx, f.cfg)
}
