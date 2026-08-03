package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/go-redis/redis/v8"
)

type AgentRunEventNotification struct {
	EID         int64  `json:"eid"`
	RunID       string `json:"run_id"`
	Seq         int64  `json:"seq"`
	PublishedAt int64  `json:"published_at"`
}

type AgentRunEventSubscription interface {
	Notifications() <-chan AgentRunEventNotification
	Close() error
}

type AgentRunEventBroker interface {
	Publish(context.Context, AgentRunEventNotification) error
	Subscribe(context.Context, int64, string) (AgentRunEventSubscription, error)
}

type localAgentRunEventBroker struct {
	mu          sync.RWMutex
	nextID      atomic.Uint64
	subscribers map[string]map[uint64]chan AgentRunEventNotification
}

func newLocalAgentRunEventBroker() *localAgentRunEventBroker {
	return &localAgentRunEventBroker{subscribers: make(map[string]map[uint64]chan AgentRunEventNotification)}
}

func agentRunEventBrokerKey(eid int64, runID string) string {
	return fmt.Sprintf("%d:%s", eid, runID)
}

func (b *localAgentRunEventBroker) Publish(_ context.Context, notification AgentRunEventNotification) error {
	if b == nil {
		return nil
	}
	key := agentRunEventBrokerKey(notification.EID, notification.RunID)
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, subscriber := range b.subscribers[key] {
		select {
		case subscriber <- notification:
		default:
			// Notifications are wake-up hints. A full channel is safe because the
			// subscriber always reconciles durable events by seq from the database.
		}
	}
	return nil
}

func (b *localAgentRunEventBroker) Subscribe(ctx context.Context, eid int64, runID string) (AgentRunEventSubscription, error) {
	if b == nil {
		return nil, fmt.Errorf("agent run event broker is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	key := agentRunEventBrokerKey(eid, runID)
	id := b.nextID.Add(1)
	ch := make(chan AgentRunEventNotification, 8)
	b.mu.Lock()
	if b.subscribers[key] == nil {
		b.subscribers[key] = make(map[uint64]chan AgentRunEventNotification)
	}
	b.subscribers[key][id] = ch
	b.mu.Unlock()

	sub := &localAgentRunEventSubscription{broker: b, key: key, id: id, ch: ch, done: make(chan struct{})}
	go func() {
		select {
		case <-ctx.Done():
			_ = sub.Close()
		case <-sub.done:
		}
	}()
	return sub, nil
}

type localAgentRunEventSubscription struct {
	broker *localAgentRunEventBroker
	key    string
	id     uint64
	ch     chan AgentRunEventNotification
	done   chan struct{}
	once   sync.Once
}

func (s *localAgentRunEventSubscription) Notifications() <-chan AgentRunEventNotification {
	return s.ch
}

func (s *localAgentRunEventSubscription) Close() error {
	if s == nil {
		return nil
	}
	s.once.Do(func() {
		s.broker.mu.Lock()
		if subscribers := s.broker.subscribers[s.key]; subscribers != nil {
			delete(subscribers, s.id)
			if len(subscribers) == 0 {
				delete(s.broker.subscribers, s.key)
			}
		}
		close(s.ch)
		s.broker.mu.Unlock()
		close(s.done)
	})
	return nil
}

type redisAgentRunPubSubClient interface {
	Publish(context.Context, string, interface{}) *redis.IntCmd
	Subscribe(context.Context, ...string) *redis.PubSub
}

type adaptiveAgentRunEventBroker struct {
	local *localAgentRunEventBroker
}

func newAgentRunEventBroker() AgentRunEventBroker {
	return &adaptiveAgentRunEventBroker{local: newLocalAgentRunEventBroker()}
}

func redisAgentRunBrokerClient() redisAgentRunPubSubClient {
	if !common.RedisEnabled || common.RDB == nil {
		return nil
	}
	client, _ := common.RDB.(redisAgentRunPubSubClient)
	return client
}

func agentRunRedisChannel(eid int64, runID string) string {
	return fmt.Sprintf("agent-run-events:%d:%s", eid, runID)
}

func (b *adaptiveAgentRunEventBroker) Publish(ctx context.Context, notification AgentRunEventNotification) error {
	if notification.PublishedAt == 0 {
		notification.PublishedAt = time.Now().UnixMilli()
	}
	if err := b.local.Publish(ctx, notification); err != nil {
		return err
	}
	client := redisAgentRunBrokerClient()
	if client == nil {
		return nil
	}
	payload, err := json.Marshal(notification)
	if err != nil {
		return err
	}
	return client.Publish(ctx, agentRunRedisChannel(notification.EID, notification.RunID), payload).Err()
}

func (b *adaptiveAgentRunEventBroker) Subscribe(ctx context.Context, eid int64, runID string) (AgentRunEventSubscription, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	localSub, err := b.local.Subscribe(ctx, eid, runID)
	if err != nil {
		return nil, err
	}
	client := redisAgentRunBrokerClient()
	if client == nil {
		return localSub, nil
	}
	pubsub := client.Subscribe(ctx, agentRunRedisChannel(eid, runID))
	// Subscribe only queues the command. Complete a bounded handshake before
	// returning so a publish immediately after WatchEventsForUser cannot be lost
	// between instances. Local delivery and periodic DB reconciliation remain the
	// fallback when Redis is unavailable.
	if _, receiveErr := pubsub.ReceiveTimeout(ctx, 250*time.Millisecond); receiveErr != nil {
		_ = pubsub.Close()
		logger.Warnf(ctx, "agent run redis subscription unavailable, using local broker: eid=%d, run_id=%s, err=%v", eid, runID, receiveErr)
		return localSub, nil
	}
	return newMergedAgentRunEventSubscription(ctx, localSub, pubsub), nil
}

type mergedAgentRunEventSubscription struct {
	cancel context.CancelFunc
	local  AgentRunEventSubscription
	redis  *redis.PubSub
	out    chan AgentRunEventNotification
	once   sync.Once
	wg     sync.WaitGroup
}

func newMergedAgentRunEventSubscription(parent context.Context, local AgentRunEventSubscription, pubsub *redis.PubSub) *mergedAgentRunEventSubscription {
	ctx, cancel := context.WithCancel(parent)
	sub := &mergedAgentRunEventSubscription{cancel: cancel, local: local, redis: pubsub, out: make(chan AgentRunEventNotification, 16)}
	sub.wg.Add(2)
	go func() {
		defer sub.wg.Done()
		for {
			select {
			case notification, ok := <-local.Notifications():
				if !ok {
					return
				}
				sub.forward(ctx, notification)
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		defer sub.wg.Done()
		ch := pubsub.Channel()
		for {
			select {
			case message, ok := <-ch:
				if !ok {
					return
				}
				var notification AgentRunEventNotification
				if json.Unmarshal([]byte(message.Payload), &notification) == nil {
					sub.forward(ctx, notification)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	return sub
}

func (s *mergedAgentRunEventSubscription) forward(ctx context.Context, notification AgentRunEventNotification) {
	select {
	case s.out <- notification:
	default:
	case <-ctx.Done():
	}
}

func (s *mergedAgentRunEventSubscription) Notifications() <-chan AgentRunEventNotification {
	return s.out
}

func (s *mergedAgentRunEventSubscription) Close() error {
	if s == nil {
		return nil
	}
	var closeErr error
	s.once.Do(func() {
		s.cancel()
		_ = s.local.Close()
		closeErr = s.redis.Close()
		s.wg.Wait()
		close(s.out)
	})
	return closeErr
}
