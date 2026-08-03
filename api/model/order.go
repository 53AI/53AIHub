package model

import (
	"errors"
	"time"
)

// Order status constants
const (
	OrderStatusConfirming = 1 // Manual payment confirming
	OrderStatusPending    = 2 // Pending payment
	OrderStatusPaid       = 3 // Paid
	OrderStatusExpired    = 4 // Expired
	OrderStatusClosed     = 5 // Closed
)

// Service type constants
const (
	ServiceTypeSubscription = 1 // Subscription service
)

// WechatPay trade_type constants
const (
	TradeTypeJSAPI    = "JSAPI"    // Public account payment, Mini Program payment
	TradeTypeNative   = "NATIVE"   // Native payment
	TradeTypeApp      = "APP"      // APP payment
	TradeTypeMicroPay = "MICROPAY" // Payment code payment
	TradeTypeMWeb     = "MWEB"     // H5 payment
	TradeTypeFacePay  = "FACEPAY"  // Face payment
)

// WechatPay trade_state constants
const (
	TradeStateSuccess    = "SUCCESS"    // Payment successful
	TradeStateRefund     = "REFUND"     // Refund initiated
	TradeStateNotPay     = "NOTPAY"     // Not paid
	TradeStateClosed     = "CLOSED"     // Order closed
	TradeStateRevoked    = "REVOKED"    // Order revoked (only for payment code)
	TradeStateUserPaying = "USERPAYING" // User is paying (only for payment code)
	TradeStatePayError   = "PAYERROR"   // Payment failed (only for payment code)

	// alipay trade_state constants
	TradeStateWaitBuyerPay = "WAIT_BUYER_PAY" // Waiting for buyer to pay
	TradeStateTradeClosed  = "TRADE_CLOSED"   // Trade closed
	TradeStateTradeSuccess = "TRADE_SUCCESS"  // Trade succeeded
	TradeStateTradeFinish  = "TRADE_FINISHED" // Trade finished
)

// Order represents an order record
type Order struct {
	ID               int64  `json:"id" gorm:"primaryKey"`                                                                  // Primary key ID
	Eid              int64  `json:"eid" gorm:"index;comment:'Enterprise ID'"`                                              // Enterprise ID
	OrderId          string `json:"order_id" gorm:"uniqueIndex;size:32;comment:'Order Number'"`                            // Order number
	ServiceID        int64  `json:"service_id" gorm:"comment:'Service ID'"`                                                // Service ID
	ServiceType      int    `json:"service_type" gorm:"comment:'Service Type 1:Subscription Service'"`                     // Service type 1:Subscription service
	SubscriptionName string `json:"subscription_name" gorm:"comment:'Subscription name'"`                                  // Subscription name
	Duration         int    `json:"duration" gorm:"comment:'Subscription Duration'"`                                       // Subscription duration
	TimeUnit         string `json:"time_unit" gorm:"comment:'Time unit: year/month/week/day/quarter'"`                     // Time unit: year/month/week/day/quarter
	Currency         string `json:"currency" gorm:"type:varchar(10);not null;column:currency;comment:'Currency: CNY/USD'"` // Currency type: CNY/USD
	Amount           int64  `json:"amount" gorm:"comment:'Order Amount'"`                                                  // Order amount (in cents)
	PayType          int    `json:"pay_type" gorm:"comment:'Payment Type 1:WeChat 2:Manual 3:PayPal'"`                     // Payment type 1:WeChat 2:Manual 3:PayPal
	Status           int    `json:"status" gorm:"comment:'Order Status 1:Not confirmed 2:Pending 3:Paid 4:Expired'"`       // Order status 1:Not confirmed 2:Pending 3:Paid 4:Expired
	UserID           int64  `json:"user_id" gorm:"comment:'User ID'"`                                                      // User ID
	Nickname         string `json:"nickname" gorm:"comment:'Nickname'"`                                                    // User nickname
	TransactionId    string `json:"transaction_id" gorm:"comment:'Transaction ID'"`                                        // Transaction ID
	PayTime          int64  `json:"pay_time" gorm:"comment:'Payment Time'"`                                                // Payment time
	ExpiredTime      int64  `json:"expired_time" gorm:"comment:'Expiration Time'"`                                         // Expiration time
	BaseModel
}

// CalculateNewExpiredTime calculates the new expiration time based on user's current status and order information
func (o *Order) CalculateNewExpiredTime(user *User) (int64, error) {
	// Determine start time for calculation
	now := time.Now().UTC()
	var startTime time.Time

	// If user has expired, calculate from current time
	// If user has not expired, calculate from original expiration time
	if user.ExpiredTime < now.UnixMilli() {
		startTime = now
	} else {
		startTime = time.UnixMilli(user.ExpiredTime).UTC()
	}

	// Calculate new expiration time based on time unit
	var endTime time.Time

	switch o.TimeUnit {
	case "day":
		endTime = startTime.AddDate(0, 0, o.Duration)
	case "week":
		endTime = startTime.AddDate(0, 0, o.Duration*7)
	case "month":
		endTime = startTime.AddDate(0, o.Duration, 0)
	case "quarter":
		endTime = startTime.AddDate(0, o.Duration*3, 0)
	case "year":
		endTime = startTime.AddDate(o.Duration, 0, 0)
	default:
		return 0, errors.New("unsupported time unit: " + o.TimeUnit)
	}

	// Convert to milliseconds for storage
	return endTime.UnixMilli(), nil
}

// GetOrderByID gets an order by order ID
func GetOrderByID(eid int64, id int64) (*Order, error) {
	var order Order
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&order).Error
	return &order, err
}

// GetOrderByOrderId gets an order by order ID
func GetOrderByOrderId(eid int64, orderId string) (*Order, error) {
	var order Order
	err := DB.Where("eid = ? AND order_id = ?", eid, orderId).First(&order).Error
	return &order, err
}

// UpdateOrderStatus updates the status of an order
func UpdateOrderStatus(eid int64, orderId string, status int) error {
	return DB.Model(&Order{}).Where("eid = ? AND order_id = ?", eid, orderId).
		Updates(map[string]interface{}{
			"status": status,
		}).Error
}

// UpdateOrderPaid updates an order as paid
func UpdateOrderPaid(eid int64, orderId string, transactionId string) error {
	// Use current time as payment time
	return UpdateOrderPaidWithTime(eid, orderId, transactionId, time.Now().UTC().UnixMilli())
}

func UpdateOrderPaidWithTime(eid int64, orderId string, transactionId string, payTime int64) error {
	// Start transaction
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Query updated order
	var order Order
	if err := tx.Where("eid = ? AND order_id = ?", eid, orderId).First(&order).Error; err != nil {
		tx.Rollback()
		return err
	}

	if order.PayTime == payTime {
		// If payment time is the same, no need to update
		return nil
	}

	// Update order status
	if err := tx.Model(&Order{}).
		Where("eid = ? AND order_id = ?", eid, orderId).
		Updates(map[string]interface{}{
			"status":         OrderStatusPaid,
			"transaction_id": transactionId,
			"pay_time":       payTime,
		}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// If it's a subscription service, update user's expiration time
	if order.ServiceType == ServiceTypeSubscription {
		// Get user information
		var user User
		if err := tx.Where("user_id = ? AND eid = ?", order.UserID, eid).First(&user).Error; err != nil {
			tx.Rollback()
			return errors.New("user not found for order: " + err.Error())
		}

		newExpiredTime, err := order.CalculateNewExpiredTime(&user)
		if err != nil {
			tx.Rollback()
			return err
		}

		// Update user expiration time
		if err := tx.Model(&User{}).
			Where("user_id = ? AND eid = ?", order.UserID, eid).
			Updates(map[string]interface{}{
				"expired_time": newExpiredTime,
				"group_id":     order.ServiceID,
			}).Error; err != nil {
			tx.Rollback()
			return errors.New("failed to update user expiration time and group_id: " + err.Error())
		}
	}

	// Commit transaction
	return tx.Commit().Error
}

// TableName returns the table name for the Order model
func (o *Order) TableName() string {
	return "orders"
}

// Create creates a new order record
func (o *Order) Create() error {
	return DB.Create(o).Error
}

// Update updates an existing order record
func (o *Order) Update() error {
	return DB.Save(o).Error
}

// Delete deletes an order record
func (o *Order) Delete() error {
	return DB.Delete(o).Error
}

// GetOrders gets orders with pagination
func GetOrders(eid, userID int64, status, page, pageSize int) ([]*Order, int64, error) {
	var orders []*Order
	var total int64

	query := DB.Model(&Order{}).Where("eid = ?", eid)

	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}

	if status > 0 {
		query = query.Where("status = ?", status)
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	err = query.Order("id DESC").Offset(offset).Limit(pageSize).Find(&orders).Error
	if err != nil {
		return nil, 0, err
	}

	return orders, total, nil
}

// GetUserOrders gets orders for a specific user
func GetUserOrders(eid int64, userID int64) ([]*Order, error) {
	var orders []*Order
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).Order("id DESC").Find(&orders).Error
	return orders, err
}

// GetPendingOrders gets all pending orders
func GetPendingOrders() ([]*Order, error) {
	var orders []*Order
	err := DB.Where("status = ?", OrderStatusPending).Find(&orders).Error
	return orders, err
}

// GetExpiredOrders gets all expired orders
func GetExpiredOrders() ([]*Order, error) {
	var orders []*Order
	err := DB.Where("status = ?", OrderStatusExpired).Find(&orders).Error
	return orders, err
}

// GetOrdersByStatus gets orders by status
func GetOrdersByStatus(eid int64, status int) ([]*Order, error) {
	var orders []*Order
	err := DB.Where("eid = ? AND status = ?", eid, status).Order("id DESC").Find(&orders).Error
	return orders, err
}

// CountOrdersByStatus counts orders by status
func CountOrdersByStatus(eid int64, status int) (int64, error) {
	var count int64
	err := DB.Model(&Order{}).Where("eid = ? AND status = ?", eid, status).Count(&count).Error
	return count, err
}

// GetOrderStatistics gets order statistics
func GetOrderStatistics(eid int64) (map[string]interface{}, error) {
	var totalAmount float64
	var totalCount, pendingCount, paidCount, expiredCount int64

	// Get total amount and count
	err := DB.Model(&Order{}).Where("eid = ?", eid).Count(&totalCount).Error
	if err != nil {
		return nil, err
	}

	err = DB.Model(&Order{}).Where("eid = ? AND status = ?", eid, OrderStatusPaid).
		Select("COALESCE(SUM(amount), 0)").Scan(&totalAmount).Error
	if err != nil {
		return nil, err
	}

	// Get counts by status
	err = DB.Model(&Order{}).Where("eid = ? AND status = ?", eid, OrderStatusPending).Count(&pendingCount).Error
	if err != nil {
		return nil, err
	}

	err = DB.Model(&Order{}).Where("eid = ? AND status = ?", eid, OrderStatusPaid).Count(&paidCount).Error
	if err != nil {
		return nil, err
	}

	err = DB.Model(&Order{}).Where("eid = ? AND status = ?", eid, OrderStatusExpired).Count(&expiredCount).Error
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"totalAmount":  totalAmount,
		"totalCount":   totalCount,
		"pendingCount": pendingCount,
		"paidCount":    paidCount,
		"expiredCount": expiredCount,
	}, nil
}

// GetRecentOrders gets recent orders
func GetRecentOrders(eid int64, limit int) ([]*Order, error) {
	var orders []*Order
	err := DB.Where("eid = ?", eid).Order("id DESC").Limit(limit).Find(&orders).Error
	return orders, err
}

// GetOrdersWithFilters gets orders with extended filters
func GetOrdersWithFilters(eid int64, userID int64, status, payType int, keyword string, subscriptionID int64, startTime, endTime int64, offset, limit int) ([]*Order, int64, error) {
	query := DB.Model(&Order{}).Where("eid = ?", eid)

	// Filter by user ID
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}

	// Filter by status
	if status >= 0 {
		query = query.Where("status = ?", status)
	}

	// Filter by payment type
	if payType >= 0 {
		query = query.Where("pay_type = ?", payType)
	}

	// Filter by keyword (user ID )
	if keyword != "" {
		query = query.Where("order_id LIKE ? OR nickname LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	// Filter by subscription ID
	if subscriptionID > 0 {
		query = query.Where("service_id = ?", subscriptionID)
	}

	// Validate and apply time range filters
	if startTime > 0 {
		query = query.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_time <= ?", endTime)
	}

	// Count total records
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Get paginated results
	var orders []*Order
	if err := query.Offset(offset).Limit(limit).Order("created_time DESC").Find(&orders).Error; err != nil {
		return nil, 0, err
	}

	return orders, total, nil
}

// UpdateExpiredOrders updates orders that have passed their expiration time
// It finds all orders with expiration time earlier than current time and status still in pending state
// Returns the number of affected records and any error that occurred
func UpdateExpiredOrders() (int64, error) {
	now := time.Now().UTC().UnixMilli()
	result := DB.Model(&Order{}).
		Where("expired_time < ? AND status = ? ", now, OrderStatusPending).
		Updates(map[string]interface{}{
			"status": OrderStatusExpired,
		})
	return result.RowsAffected, result.Error
}

func GetExpiredPendingOrders(expireTime time.Time) ([]Order, error) {
	var orders []Order
	err := DB.Where("status = ? AND expired_time < ?", OrderStatusPending, expireTime).Find(&orders).Error
	return orders, err
}
