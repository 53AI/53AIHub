package actionruntime

import (
	"context"
	"errors"
	"sync"
	"time"
)

type FakeAdapter struct {
	mu               sync.Mutex
	startSessionErr  error
	startRunErr      error
	cancelled        bool
	events           []ActionEvent
	nextID           int
	// hold>0 时 StartRun 保持 Run 活跃，直到 Release；用于验证"运行中"的幂等语义。
	hold int
}

func NewFakeAdapter(events []ActionEvent) *FakeAdapter {
	return &FakeAdapter{events: append([]ActionEvent(nil), events...)}
}

func (a *FakeAdapter) Name() string { return "fake" }

func (a *FakeAdapter) Capabilities() []Capability {
	return []Capability{CapabilityStreaming, CapabilityCancel, CapabilityArtifact}
}

func (a *FakeAdapter) StartSession(_ context.Context, _ SessionRequest) (RuntimeSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startSessionErr != nil {
		return RuntimeSession{}, a.startSessionErr
	}
	a.nextID++
	return RuntimeSession{ID: "fake-session", Runtime: a.Name(), ExternalID: "fake-thread", Status: SessionStatusReady}, nil
}

func (a *FakeAdapter) StartRun(ctx context.Context, _ RunRequest) (<-chan ActionEvent, error) {
	a.mu.Lock()
	if a.startRunErr != nil {
		err := a.startRunErr
		a.mu.Unlock()
		return nil, err
	}
	configured := append([]ActionEvent(nil), a.events...)
	a.mu.Unlock()

	output := make(chan ActionEvent, len(configured))
	go func() {
		for a.holding() {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Millisecond):
			}
		}
		defer close(output)
		for _, event := range configured {
			select {
			case output <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	return output, nil
}

func (a *FakeAdapter) Cancel(_ context.Context, _ RuntimeSession, _ ActionRun) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cancelled = true
	return nil
}

// Hold 让 StartRun 返回的 Run 保持活跃；Release 后才结束（用于运行中幂等验证）。
func (a *FakeAdapter) Hold() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.hold++
}

func (a *FakeAdapter) Release() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.hold > 0 {
		a.hold--
	}
}

func (a *FakeAdapter) holding() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.hold > 0
}

func (a *FakeAdapter) SetStartSessionError(err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.startSessionErr = err
}

func (a *FakeAdapter) SetStartRunError(err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.startRunErr = err
}

func (a *FakeAdapter) Cancelled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cancelled
}

var _ RuntimeAdapter = (*FakeAdapter)(nil)

var ErrFake = errors.New("fake runtime error")
