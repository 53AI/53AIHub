package sms

import "errors"

var (
	ErrSendTooFrequent    = errors.New("sms: send too frequent")
	ErrMobileDailyLimit   = errors.New("sms: mobile daily limit")
	ErrIPBurstLimit       = errors.New("sms: ip burst limit")
	ErrIPHourlyLimit      = errors.New("sms: ip hourly limit")
	ErrIPDailyLimit       = errors.New("sms: ip daily limit")
	ErrVerifyTooManyTries = errors.New("sms: verify too many tries")
	ErrRedisUnavailable   = errors.New("sms: redis unavailable")
	ErrIPBanned            = errors.New("sms: ip banned")
	ErrIPTotalLimit        = errors.New("sms: ip total limit")
	ErrEidDailyLimit       = errors.New("sms: eid daily limit")
	ErrVerifyIPLimit       = errors.New("sms: verify ip limit")
	ErrVerifyCooldown      = errors.New("sms: verify cooldown")
)
