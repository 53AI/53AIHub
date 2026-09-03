package tasks

import (
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const (
	// Cache key for expired orders
	ExpiredOrderCacheKey = "order:expired_queue"
)

// StartOrderExpirationTask starts a periodic task to update expired orders
// It runs at the specified interval and updates orders that have passed their expiration time
func StartOrderExpirationTask(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Run immediately on start
		processExpiredOrders()

		for range ticker.C {
			processExpiredOrders()
		}
	}()
	logger.SysLog("Order expiration task started with interval: " + interval.String())
}

// processExpiredOrders processes all expired orders and updates their status
func processExpiredOrders() {
	redisEnabled := common.IsRedisEnabled()

	if redisEnabled {
		processExpiredOrdersWithRedis()
	} else {
		processExpiredOrdersWithDB()
	}
}

func processExpiredOrdersWithRedis() {
	now := time.Now().UnixMilli()

	orderIDs, err := common.RedisZRangeByScore(ExpiredOrderCacheKey, 0, now)
	if err != nil {
		logger.SysError("Failed to get expired orders from cache: " + err.Error())
		return
	}

	if len(orderIDs) == 0 {
		return
	}

	count := 0
	ordersByEid := make(map[int64][]string)

	for _, orderIDWithEid := range orderIDs {
		parts := strings.Split(orderIDWithEid, ":")
		if len(parts) != 2 {
			logger.SysError("Invalid order ID format in cache: " + orderIDWithEid)
			_, err = common.RedisZRem(ExpiredOrderCacheKey, orderIDWithEid)
			if err != nil {
				logger.SysError("Failed to remove invalid order from cache: " + err.Error())
			}
			continue
		}

		eid, orderID := parts[0], parts[1]
		eidInt, err := ParseInt64(eid)
		if err != nil {
			logger.SysErrorf("Invalid enterprise ID in cache: %v, Value: %s", err, eid)
			_, err = common.RedisZRem(ExpiredOrderCacheKey, orderIDWithEid)
			if err != nil {
				logger.SysError("Failed to remove invalid order from cache: " + err.Error())
			}
			continue
		}

		ordersByEid[eidInt] = append(ordersByEid[eidInt], orderID)
	}

	for eid, orderIDs := range ordersByEid {
		for _, orderID := range orderIDs {
			order, err := model.GetOrderByOrderId(eid, orderID)
			if err != nil {
				logger.SysErrorf("Failed to get order information: %v, Enterprise ID: %d, Order ID: %s", err, eid, orderID)
				continue
			}

			if order.Status == model.OrderStatusPending {
				err = model.UpdateOrderStatus(eid, orderID, model.OrderStatusExpired)
				if err != nil {
					logger.SysErrorf("Failed to update order status: %v, Enterprise ID: %d, Order ID: %s", err, eid, orderID)
					continue
				}
				count++
			}

			combinedID := fmt.Sprintf("%d:%s", eid, orderID)
			_, err = common.RedisZRem(ExpiredOrderCacheKey, combinedID)
			if err != nil {
				logger.SysErrorf("Failed to remove order from cache: %v, Enterprise ID: %d, Order ID: %s", err, eid, orderID)
			}
		}
	}

	if count > 0 {
		logger.SysLogf("Updated %d expired orders using Redis", count)
	}
}

func processExpiredOrdersWithDB() {
	now := time.Now()

	expiredOrders, err := model.GetExpiredPendingOrders(now)
	if err != nil {
		logger.SysError("Failed to get expired orders from database: " + err.Error())
		return
	}

	if len(expiredOrders) == 0 {
		return
	}

	count := 0
	for _, order := range expiredOrders {
		err = model.UpdateOrderStatus(order.Eid, order.OrderId, model.OrderStatusExpired)
		if err != nil {
			logger.SysErrorf("Failed to update order status: %v, Enterprise ID: %d, Order ID: %s", err, order.Eid, order.OrderId)
			continue
		}
		count++
	}

	if count > 0 {
		logger.SysLogf("Updated %d expired orders using database query", count)
	}
}

func AddOrderToExpirationQueue(eid int64, orderID string, expireTime int64) error {
	combinedID := fmt.Sprintf("%d:%s", eid, orderID)

	_, err := common.RedisZAdd(ExpiredOrderCacheKey, expireTime, combinedID)
	if err != nil {
		logger.SysErrorf("Failed to add order to expiration queue: %v, Enterprise ID: %d, Order ID: %s", err, eid, orderID)
		return err
	}
	return nil
}

// ParseInt64 is a helper function to parse string to int64
func ParseInt64(s string) (int64, error) {
	var i int64
	_, err := fmt.Sscanf(s, "%d", &i)
	return i, err
}
