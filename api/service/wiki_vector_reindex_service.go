package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const wikiVectorReindexCollectionPrefix = "wiki_eid_"

type WikiVectorReindexResult struct {
	Eid            int64
	PagesTotal     int
	PagesSucceeded int
	PagesFailed    int
	PageErrors     []error
}

type WikiVectorCollectionStore interface {
	DeleteCollection(ctx context.Context, name string) error
}

type WikiVectorReindexLocker interface {
	Acquire(ctx context.Context, eid int64) (WikiVectorReindexLease, error)
}

type WikiVectorReindexLease interface {
	Renew(ctx context.Context) error
	Release(ctx context.Context) error
}

type noopWikiVectorReindexLocker struct{}

func (noopWikiVectorReindexLocker) Acquire(context.Context, int64) (WikiVectorReindexLease, error) {
	return noopWikiVectorReindexLease{}, nil
}

type noopWikiVectorReindexLease struct{}

func (noopWikiVectorReindexLease) Renew(context.Context) error   { return nil }
func (noopWikiVectorReindexLease) Release(context.Context) error { return nil }

const wikiVectorReindexLockTTL = 30 * time.Minute

type redisWikiVectorReindexLocker struct{}

type redisWikiVectorReindexLease struct {
	key   string
	token string
}

func (redisWikiVectorReindexLocker) Acquire(ctx context.Context, eid int64) (WikiVectorReindexLease, error) {
	if !common.IsRedisEnabled() || common.RDB == nil {
		return noopWikiVectorReindexLease{}, nil
	}
	key := wikiVectorReindexLockKey(eid)
	token := uuid.NewString()
	ok, err := common.RDB.SetNX(ctx, key, token, wikiVectorReindexLockTTL).Result()
	if err != nil {
		return nil, fmt.Errorf("acquire wiki vector reindex lock: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("wiki vector reindex is busy: eid=%d", eid)
	}
	return redisWikiVectorReindexLease{key: key, token: token}, nil
}

func (l redisWikiVectorReindexLease) Renew(ctx context.Context) error {
	result, err := common.RDB.Eval(ctx, "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end", []string{l.key}, l.token, int(wikiVectorReindexLockTTL/time.Second)).Int()
	if err != nil {
		return err
	}
	if result != 1 {
		return errors.New("wiki vector reindex lock ownership lost")
	}
	return nil
}

func (l redisWikiVectorReindexLease) Release(ctx context.Context) error {
	_, err := common.RDB.Eval(ctx, "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", []string{l.key}, l.token).Result()
	return err
}

func wikiVectorReindexLockKey(eid int64) string {
	return fmt.Sprintf("wiki:vector-reindex:%d", eid)
}

type WikiVectorReindexService struct {
	db             *gorm.DB
	vectorStore    WikiVectorCollectionStore
	processor      WikiPageVectorizationProcessor
	validateConfig func(eid int64) error
	locker         WikiVectorReindexLocker
}

func NewWikiVectorReindexService(db *gorm.DB) (*WikiVectorReindexService, error) {
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		return nil, err
	}
	return NewWikiVectorReindexServiceWithDependencies(
		db,
		store,
		NewWikiPageVectorizationProcessor(db),
		func(eid int64) error {
			_, err := rag.NewChunkConfigService(db).GetEnterpriseEmbeddingConfig(eid)
			return err
		},
		redisWikiVectorReindexLocker{},
	), nil
}

func NewWikiVectorReindexServiceWithDependencies(
	db *gorm.DB,
	store WikiVectorCollectionStore,
	processor WikiPageVectorizationProcessor,
	validateConfig func(eid int64) error,
	locker WikiVectorReindexLocker,
) *WikiVectorReindexService {
	if locker == nil {
		locker = noopWikiVectorReindexLocker{}
	}
	return &WikiVectorReindexService{db: db, vectorStore: store, processor: processor, validateConfig: validateConfig, locker: locker}
}

func (s *WikiVectorReindexService) ReindexEnterprise(ctx context.Context, eid int64) (WikiVectorReindexResult, error) {
	result := WikiVectorReindexResult{Eid: eid, PageErrors: make([]error, 0)}
	if s == nil || s.db == nil || s.vectorStore == nil || s.processor == nil || s.validateConfig == nil {
		return result, errors.New("wiki vector reindex dependencies are incomplete")
	}
	if eid <= 0 {
		return result, errors.New("eid is required")
	}
	if err := s.validateConfig(eid); err != nil {
		return result, fmt.Errorf("validate enterprise embedding config: %w", err)
	}
	lease, err := s.locker.Acquire(ctx, eid)
	if err != nil {
		return result, err
	}
	defer func() { _ = lease.Release(context.Background()) }()
	if err := lease.Renew(ctx); err != nil {
		return result, fmt.Errorf("renew wiki vector reindex lock: %w", err)
	}

	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND status = ? AND current_version_id > 0", eid, model.WikiPageStatusActive).
		Order("id ASC").Find(&pages).Error; err != nil {
		return result, fmt.Errorf("load wiki pages: %w", err)
	}
	result.PagesTotal = len(pages)

	collection := fmt.Sprintf("%s%d", wikiVectorReindexCollectionPrefix, eid)
	if err := s.vectorStore.DeleteCollection(ctx, collection); err != nil && !vectorstore.IsNotFoundError(err) {
		return result, fmt.Errorf("delete wiki vector collection %s: %w", collection, err)
	}

	for _, page := range pages {
		if err := lease.Renew(ctx); err != nil {
			return result, fmt.Errorf("renew wiki vector reindex lock: %w", err)
		}
		var version model.WikiPageVersion
		if err := s.db.WithContext(ctx).
			Where("eid = ? AND page_id = ? AND id = ? AND is_published = ?", eid, page.ID, page.CurrentVersionID, true).
			First(&version).Error; err != nil {
			result.PagesFailed++
			result.PageErrors = append(result.PageErrors, fmt.Errorf("page %d current version %d: %w", page.ID, page.CurrentVersionID, err))
			continue
		}
		if err := s.processor.Process(ctx, eid, page.ID, version.ID, true); err != nil {
			result.PagesFailed++
			result.PageErrors = append(result.PageErrors, fmt.Errorf("vectorize page %d: %w", page.ID, err))
			continue
		}
		result.PagesSucceeded++
	}
	if len(result.PageErrors) > 0 {
		return result, fmt.Errorf("wiki vector reindex completed with %d page failures", len(result.PageErrors))
	}
	return result, nil
}
