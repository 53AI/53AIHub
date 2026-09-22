package actionruntime

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

var (
	ErrRuntimeNameRequired = errors.New("runtime name is required")
	ErrRuntimeNotFound     = errors.New("runtime adapter not found")
	ErrRuntimeDuplicate    = errors.New("runtime adapter already registered")
)

type Registry struct {
	mu       sync.RWMutex
	adapters map[string]RuntimeAdapter
}

func NewRegistry() *Registry {
	return &Registry{adapters: make(map[string]RuntimeAdapter)}
}

func (r *Registry) Register(adapter RuntimeAdapter) error {
	if r == nil || adapter == nil {
		return ErrAdapterRequired
	}
	name := adapter.Name()
	if name == "" {
		return ErrRuntimeNameRequired
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.adapters[name]; exists {
		return fmt.Errorf("%w: %s", ErrRuntimeDuplicate, name)
	}
	r.adapters[name] = adapter
	return nil
}

func (r *Registry) Get(name string) (RuntimeAdapter, error) {
	if r == nil {
		return nil, ErrRuntimeNotFound
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapter, ok := r.adapters[name]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrRuntimeNotFound, name)
	}
	return adapter, nil
}

func (r *Registry) Names() []string {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.adapters))
	for name := range r.adapters {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
