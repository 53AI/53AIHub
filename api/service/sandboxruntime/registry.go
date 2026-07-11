package sandboxruntime

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

type ProviderFactory func(ctx context.Context, cfg ProviderConfig) (Runtime, error)

type Registry struct {
	mu        sync.RWMutex
	providers map[string]ProviderFactory
}

var defaultRegistry = NewRegistry()

func NewRegistry() *Registry {
	return &Registry{providers: map[string]ProviderFactory{}}
}

func RegisterProvider(name string, factory ProviderFactory) {
	defaultRegistry.Register(name, factory)
}

func normalizeProviderName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func providerNameFromContext(ctx context.Context, fallback string) string {
	if ctx != nil {
		if raw := ctx.Value(ProviderKey{}); raw != nil {
			if provider, ok := raw.(string); ok {
				if normalized := normalizeProviderName(provider); normalized != "" {
					return normalized
				}
			}
		}
	}
	return normalizeProviderName(fallback)
}

func (r *Registry) Register(name string, factory ProviderFactory) {
	name = normalizeProviderName(name)
	if name == "" || factory == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.providers == nil {
		r.providers = map[string]ProviderFactory{}
	}
	r.providers[name] = factory
}

func (r *Registry) New(ctx context.Context, cfg ProviderConfig) (Runtime, error) {
	provider := providerNameFromContext(ctx, cfg.Provider)
	if provider == "" {
		provider = "docker"
	}

	r.mu.RLock()
	factory, ok := r.providers[provider]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown sandbox runtime provider %q", provider)
	}
	return factory(ctx, cfg)
}
