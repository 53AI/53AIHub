package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	wikiPageUpdatePendingOpKind = "wiki_page_update"
	wikiPageUpdateLeaseTTL      = 2 * time.Minute
	wikiPageUpdateCollectWindow = 250 * time.Millisecond
)

type wikiPageUpdatePendingPayload struct {
	LibraryID   int64          `json:"library_id"`
	Slug        string         `json:"slug"`
	SourceJobID int64          `json:"source_job_id"`
	BatchID     string         `json:"batch_id,omitempty"`
	Update      WikiSlugUpdate `json:"update"`
}

type wikiPageUpdateBatchClaim struct {
	BatchID string
	Owner   string
	Ops     []model.WikiPendingOp
	Updates []WikiSlugUpdate
}

type wikiPageUpdateBatchClaimContextKey struct{}

func withWikiPageUpdateBatchClaim(ctx context.Context, claim *wikiPageUpdateBatchClaim) context.Context {
	return context.WithValue(ctx, wikiPageUpdateBatchClaimContextKey{}, claim)
}

func wikiPageUpdateBatchClaimFromContext(ctx context.Context) *wikiPageUpdateBatchClaim {
	claim, _ := ctx.Value(wikiPageUpdateBatchClaimContextKey{}).(*wikiPageUpdateBatchClaim)
	return claim
}

func enqueueWikiPageUpdate(ctx context.Context, db *gorm.DB, eid, jobID int64, update WikiSlugUpdate) (*model.WikiPendingOp, error) {
	if db == nil {
		return nil, fmt.Errorf("wiki page update batch database is nil")
	}
	var rows []model.WikiPendingOp
	if err := db.WithContext(ctx).Where("eid = ? AND op_kind = ?", eid, wikiPageUpdatePendingOpKind).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		var payload wikiPageUpdatePendingPayload
		if err := json.Unmarshal([]byte(rows[i].Payload), &payload); err != nil {
			return nil, fmt.Errorf("parse wiki page update op %d: %w", rows[i].ID, err)
		}
		if payload.LibraryID == update.LibraryID && payload.Slug == update.Slug && payload.SourceJobID == jobID &&
			payload.Update.SourceFileID == update.SourceFileID && payload.Update.SourceContentHash == update.SourceContentHash {
			if rows[i].Status == model.WikiPendingOpStatusFailed {
				if err := db.WithContext(ctx).Model(&rows[i]).Updates(map[string]any{"status": model.WikiPendingOpStatusQueued, "locked_by": "", "locked_time": 0, "last_error": ""}).Error; err != nil {
					return nil, err
				}
				rows[i].Status = model.WikiPendingOpStatusQueued
			}
			merged := mergeWikiPageUpdateBatch([]WikiSlugUpdate{payload.Update, update})[0]
			if wikiPageUpdatesEqual(payload.Update, merged) {
				return &rows[i], nil
			}
			if rows[i].Status == model.WikiPendingOpStatusQueued {
				payload.Update = merged
				data, err := json.Marshal(payload)
				if err != nil {
					return nil, err
				}
				if err := db.WithContext(ctx).Model(&rows[i]).Update("payload", string(data)).Error; err != nil {
					return nil, err
				}
				rows[i].Payload = string(data)
				return &rows[i], nil
			}
		}
	}

	payload := wikiPageUpdatePendingPayload{LibraryID: update.LibraryID, Slug: update.Slug, SourceJobID: jobID, Update: update}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	op := &model.WikiPendingOp{
		Eid:         eid,
		OpKind:      wikiPageUpdatePendingOpKind,
		Status:      model.WikiPendingOpStatusQueued,
		Payload:     string(data),
		MaxAttempts: 0,
		CreatorID:   update.Eid,
	}
	if err := db.WithContext(ctx).Create(op).Error; err != nil {
		return nil, err
	}
	return op, nil
}

func wikiPageUpdatesEqual(a, b WikiSlugUpdate) bool {
	left, err := json.Marshal(a)
	if err != nil {
		return false
	}
	right, err := json.Marshal(b)
	return err == nil && string(left) == string(right)
}

func processWikiPageUpdateBatch(ctx context.Context, db *gorm.DB, eid, jobID int64, updates []WikiSlugUpdate, acquire wikiPageUpdateBatchAcquire, compile func(context.Context, *wikiPageUpdateBatchClaim) (bool, error)) (bool, error) {
	if len(updates) == 0 {
		return false, nil
	}
	first := updates[0]
	for _, update := range updates {
		if update.Eid != first.Eid || update.LibraryID != first.LibraryID || update.Slug != first.Slug {
			return false, fmt.Errorf("wiki page update batch must contain one page key")
		}
	}
	memberOps := make([]*model.WikiPendingOp, 0, len(updates))
	for _, update := range updates {
		op, err := enqueueWikiPageUpdate(ctx, db, eid, jobID, update)
		if err != nil {
			return false, err
		}
		memberOps = append(memberOps, op)
	}
	if allWikiPageUpdateOpsDone(memberOps) {
		return false, nil
	}
	lockKey := wikiPageUpdateBatchLockKey(eid, first.LibraryID, first.Slug)
	for {
		lease, acquired, err := acquire(ctx, lockKey)
		if err != nil {
			return false, err
		}
		if !acquired {
			if err := waitWikiPageUpdateBatch(ctx); err != nil {
				return false, err
			}
			if ops, err := loadWikiPageUpdateOps(ctx, db, memberOps); err != nil {
				return false, err
			} else if allWikiPageUpdateOpsDone(ops) {
				return false, nil
			}
			continue
		}
		if err := waitWikiPageUpdateCollectionWindow(ctx); err != nil {
			_ = lease.release(ctx)
			return false, err
		}
		owner := lease.token
		claim, err := claimWikiPageUpdateBatch(ctx, db, eid, first.LibraryID, first.Slug, owner)
		if err != nil {
			_ = lease.release(ctx)
			return false, err
		}
		if claim == nil {
			_ = lease.release(ctx)
			if err := waitWikiPageUpdateBatch(ctx); err != nil {
				return false, err
			}
			if ops, err := loadWikiPageUpdateOps(ctx, db, memberOps); err != nil {
				return false, err
			} else if allWikiPageUpdateOpsDone(ops) {
				return false, nil
			}
			continue
		}
		changed, err := runWithWikiPageUpdateBatchLease(ctx, lease, func(batchCtx context.Context) (bool, error) {
			return compile(withWikiPageUpdateBatchClaim(batchCtx, claim), claim)
		})
		if err != nil {
			_ = releaseWikiPageUpdateBatchClaim(ctx, db, claim, err)
			return false, err
		}
		if err := completeWikiPageUpdateBatchClaim(ctx, db, claim); err != nil {
			return changed, err
		}
		return changed, nil
	}
}

func allWikiPageUpdateOpsDone(ops []*model.WikiPendingOp) bool {
	if len(ops) == 0 {
		return false
	}
	for _, op := range ops {
		if op == nil || op.Status != model.WikiPendingOpStatusDone {
			return false
		}
	}
	return true
}

func loadWikiPageUpdateOps(ctx context.Context, db *gorm.DB, ops []*model.WikiPendingOp) ([]*model.WikiPendingOp, error) {
	loaded := make([]*model.WikiPendingOp, 0, len(ops))
	for _, op := range ops {
		var current model.WikiPendingOp
		if err := db.WithContext(ctx).First(&current, op.ID).Error; err != nil {
			return nil, err
		}
		loaded = append(loaded, &current)
	}
	return loaded, nil
}

func releaseWikiPageUpdateBatchClaim(ctx context.Context, db *gorm.DB, claim *wikiPageUpdateBatchClaim, cause error) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, op := range claim.Ops {
			if err := tx.Model(&model.WikiPendingOp{}).
				Where("id = ? AND status = ? AND locked_by = ? AND attempt_count = ?", op.ID, model.WikiPendingOpStatusProcessing, claim.Owner, op.AttemptCount).
				Updates(map[string]any{"status": model.WikiPendingOpStatusQueued, "locked_by": "", "locked_time": 0, "last_error": errorText(cause)}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func completeWikiPageUpdateBatchClaim(ctx context.Context, db *gorm.DB, claim *wikiPageUpdateBatchClaim) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		allDone := true
		for _, op := range claim.Ops {
			var current model.WikiPendingOp
			if err := tx.Select("id", "status", "payload").First(&current, op.ID).Error; err != nil {
				return err
			}
			var payload wikiPageUpdatePendingPayload
			if err := json.Unmarshal([]byte(current.Payload), &payload); err != nil {
				return err
			}
			if current.Status != model.WikiPendingOpStatusDone || payload.BatchID != claim.BatchID {
				allDone = false
			}
		}
		if allDone {
			return nil
		}
		if err := validateWikiPageUpdateBatchClaim(ctx, tx, claim); err != nil {
			return err
		}
		return completeWikiPageUpdateBatchClaimInTx(tx, claim)
	})
}

func completeWikiPageUpdateBatchClaimInTx(tx *gorm.DB, claim *wikiPageUpdateBatchClaim) error {
	for _, op := range claim.Ops {
		if err := tx.Model(&model.WikiPendingOp{}).
			Where("id = ? AND status = ? AND locked_by = ? AND attempt_count = ?", op.ID, model.WikiPendingOpStatusProcessing, claim.Owner, op.AttemptCount).
			Updates(map[string]any{"status": model.WikiPendingOpStatusDone, "locked_by": "", "locked_time": 0, "last_error": ""}).Error; err != nil {
			return err
		}
	}
	return nil
}

func wikiPageUpdateBatchLockKey(eid, libraryID int64, slug string) string {
	digest := sha256.Sum256([]byte(slug))
	return fmt.Sprintf("wiki:page-update:%d:%d:%s", eid, libraryID, hex.EncodeToString(digest[:12]))
}

type wikiPageUpdateBatchLease struct {
	key   string
	token string
	local bool
}

type wikiPageUpdateBatchAcquire func(context.Context, string) (*wikiPageUpdateBatchLease, bool, error)

func acquireWikiPageUpdateBatchLease(ctx context.Context, key string) (*wikiPageUpdateBatchLease, bool, error) {
	if !common.IsRedisEnabled() || common.RDB == nil {
		return nil, false, fmt.Errorf("redis is required for wiki page update batching")
	}
	token := uuid.NewString()
	locked, err := common.RDB.SetNX(ctx, key, token, wikiPageUpdateLeaseTTL).Result()
	if err != nil {
		return nil, false, fmt.Errorf("acquire wiki page update lease: %w", err)
	}
	if !locked {
		return nil, false, nil
	}
	return &wikiPageUpdateBatchLease{key: key, token: token}, true, nil
}

func (l *wikiPageUpdateBatchLease) renew(ctx context.Context) error {
	if l.local {
		return nil
	}
	result, err := common.RDB.Eval(ctx, "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end", []string{l.key}, l.token, int(wikiPageUpdateLeaseTTL/time.Second)).Int()
	if err != nil {
		return err
	}
	if result != 1 {
		return fmt.Errorf("wiki page update lease ownership lost")
	}
	return nil
}

func (l *wikiPageUpdateBatchLease) release(ctx context.Context) error {
	if l.local {
		return nil
	}
	_, err := common.RDB.Eval(ctx, "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", []string{l.key}, l.token).Result()
	return err
}

func runWithWikiPageUpdateBatchLease(ctx context.Context, lease *wikiPageUpdateBatchLease, process func(context.Context) (bool, error)) (bool, error) {
	workCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(wikiPageUpdateLeaseTTL / 3)
		defer ticker.Stop()
		for {
			select {
			case <-workCtx.Done():
				done <- workCtx.Err()
				return
			case <-ticker.C:
				if err := lease.renew(workCtx); err != nil {
					cancel()
					done <- err
					return
				}
			}
		}
	}()
	changed, err := process(workCtx)
	cancel()
	leaseErr := <-done
	releaseErr := lease.release(ctx)
	if err != nil {
		return changed, err
	}
	if leaseErr != nil && leaseErr != context.Canceled {
		return changed, leaseErr
	}
	if releaseErr != nil {
		return changed, releaseErr
	}
	return changed, nil
}

func waitWikiPageUpdateBatch(ctx context.Context) error {
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func waitWikiPageUpdateCollectionWindow(ctx context.Context) error {
	timer := time.NewTimer(wikiPageUpdateCollectWindow)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func claimWikiPageUpdateBatch(ctx context.Context, db *gorm.DB, eid, libraryID int64, slug, owner string) (*wikiPageUpdateBatchClaim, error) {
	if db == nil {
		return nil, fmt.Errorf("wiki page update batch database is nil")
	}
	var claim *wikiPageUpdateBatchClaim
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []model.WikiPendingOp
		if err := tx.Where("eid = ? AND op_kind = ? AND status IN ?", eid, wikiPageUpdatePendingOpKind, []string{
			model.WikiPendingOpStatusQueued,
			model.WikiPendingOpStatusProcessing,
		}).Order("id ASC").Find(&rows).Error; err != nil {
			return err
		}

		var expiredBatchID string
		now := time.Now().UnixMilli()
		staleBefore := now - wikiPageUpdateLeaseTTL.Milliseconds()
		for _, row := range rows {
			var payload wikiPageUpdatePendingPayload
			if err := json.Unmarshal([]byte(row.Payload), &payload); err != nil {
				return fmt.Errorf("parse wiki page update op %d: %w", row.ID, err)
			}
			if payload.LibraryID != libraryID || payload.Slug != slug || row.Status != model.WikiPendingOpStatusProcessing || row.LockedTime > staleBefore {
				continue
			}
			expiredBatchID = payload.BatchID
			if expiredBatchID != "" {
				break
			}
		}

		eligible := make([]model.WikiPendingOp, 0)
		payloads := make(map[int64]wikiPageUpdatePendingPayload)
		for _, row := range rows {
			var payload wikiPageUpdatePendingPayload
			if err := json.Unmarshal([]byte(row.Payload), &payload); err != nil {
				return fmt.Errorf("parse wiki page update op %d: %w", row.ID, err)
			}
			if payload.LibraryID != libraryID || payload.Slug != slug {
				continue
			}
			if expiredBatchID != "" {
				if row.Status == model.WikiPendingOpStatusProcessing && payload.BatchID == expiredBatchID {
					eligible = append(eligible, row)
					payloads[row.ID] = payload
				}
				continue
			}
			if row.Status == model.WikiPendingOpStatusQueued {
				eligible = append(eligible, row)
				payloads[row.ID] = payload
			}
		}
		if len(eligible) == 0 {
			return nil
		}

		batchID := expiredBatchID
		if batchID == "" {
			batchID = wikiPageUpdateBatchID(eligible)
		}
		claimed := make([]model.WikiPendingOp, 0, len(eligible))
		updates := make([]WikiSlugUpdate, 0, len(eligible))
		for _, row := range eligible {
			payload := payloads[row.ID]
			payload.BatchID = batchID
			data, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			result := tx.Model(&model.WikiPendingOp{}).
				Where("id = ? AND status = ? AND attempt_count = ?", row.ID, row.Status, row.AttemptCount).
				Updates(map[string]any{
					"status":        model.WikiPendingOpStatusProcessing,
					"payload":       string(data),
					"locked_by":     owner,
					"locked_time":   now,
					"attempt_count": gorm.Expr("attempt_count + ?", 1),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("wiki page update op %d was claimed concurrently", row.ID)
			}
			row.Status = model.WikiPendingOpStatusProcessing
			row.Payload = string(data)
			row.LockedBy = owner
			row.LockedTime = now
			row.AttemptCount++
			claimed = append(claimed, row)
			updates = append(updates, payload.Update)
		}
		claim = &wikiPageUpdateBatchClaim{BatchID: batchID, Owner: owner, Ops: claimed, Updates: mergeWikiPageUpdateBatch(updates)}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claim, nil
}

func wikiPageUpdateBatchID(ops []model.WikiPendingOp) string {
	ids := make([]string, 0, len(ops))
	for _, op := range ops {
		ids = append(ids, strconv.FormatInt(op.ID, 10))
	}
	sort.Strings(ids)
	digest := sha256.Sum256([]byte(strings.Join(ids, ":")))
	return hex.EncodeToString(digest[:16])
}

func validateWikiPageUpdateBatchClaim(ctx context.Context, db *gorm.DB, claim *wikiPageUpdateBatchClaim) error {
	if claim == nil || db == nil {
		return fmt.Errorf("wiki page update batch claim is required")
	}
	for _, op := range claim.Ops {
		var current model.WikiPendingOp
		if err := db.WithContext(ctx).Select("id", "status", "locked_by", "attempt_count").First(&current, op.ID).Error; err != nil {
			return err
		}
		if current.Status != model.WikiPendingOpStatusProcessing || current.LockedBy != claim.Owner || current.AttemptCount != op.AttemptCount {
			return fmt.Errorf("wiki page update batch claim expired: batch_id=%s op_id=%d", claim.BatchID, op.ID)
		}
	}
	return nil
}

func mergeWikiPageUpdateBatch(updates []WikiSlugUpdate) []WikiSlugUpdate {
	indexes := make(map[string]int, len(updates))
	merged := make([]WikiSlugUpdate, 0, len(updates))
	for _, update := range updates {
		key := strings.Join([]string{
			strconv.FormatInt(update.Eid, 10),
			strconv.FormatInt(update.LibraryID, 10),
			strings.TrimSpace(update.Slug),
			strings.TrimSpace(update.PageType),
			update.SourceContentHash,
			strconv.FormatInt(update.SourceFileID, 10),
		}, "\x00")
		if index, ok := indexes[key]; ok {
			merged[index].SourceChunks = dedupeWikiChunkRefs(append(merged[index].SourceChunks, update.SourceChunks...))
			merged[index].Aliases = mergeWikiStringSlices(merged[index].Aliases, update.Aliases)
			merged[index].Content = mergeWikiUpdateText(merged[index].Content, update.Content)
			merged[index].SummaryBody = mergeWikiUpdateText(merged[index].SummaryBody, update.SummaryBody)
			merged[index].DocSummary = mergeWikiUpdateText(merged[index].DocSummary, update.DocSummary)
			merged[index].RetractDocContent = mergeWikiUpdateText(merged[index].RetractDocContent, update.RetractDocContent)
			continue
		}
		indexes[key] = len(merged)
		update.SourceChunks = dedupeWikiChunkRefs(update.SourceChunks)
		update.Aliases = mergeWikiStringSlices(nil, update.Aliases)
		merged = append(merged, update)
	}
	return merged
}

func mergeWikiUpdateText(existing, incoming string) string {
	existing = strings.TrimSpace(existing)
	incoming = strings.TrimSpace(incoming)
	if existing == "" || incoming == "" || existing == incoming {
		return firstNonEmpty(existing, incoming)
	}
	return existing + "\n\n" + incoming
}
