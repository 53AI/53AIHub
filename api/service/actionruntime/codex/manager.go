package codex

import "sync"

type ProcessManager struct {
	mu       sync.Mutex
	sessions map[string]*process
}

func NewProcessManager() *ProcessManager {
	return &ProcessManager{sessions: make(map[string]*process)}
}

func (m *ProcessManager) Register(id string, p *process) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[id] = p
}

func (m *ProcessManager) Get(id string) (*process, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.sessions[id]
	return p, ok
}

func (m *ProcessManager) Remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
}

func (m *ProcessManager) Cancel(id string) error {
	p, ok := m.Get(id)
	if !ok {
		return nil
	}
	p.cancelled.Store(true)
	m.Remove(id)
	return p.close()
}

func (m *ProcessManager) CloseAll() error {
	m.mu.Lock()
	sessions := make(map[string]*process, len(m.sessions))
	for id, p := range m.sessions {
		sessions[id] = p
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	for _, p := range sessions {
		if err := p.close(); err != nil {
			return err
		}
	}
	return nil
}
