package providers

import (
	"sync"

	dockerruntime "github.com/53AI/53AIHub/service/sandboxruntime/docker"
)

var registerDefaultsOnce sync.Once

func RegisterDefaults() {
	registerDefaultsOnce.Do(func() {
		dockerruntime.Register()
	})
}
