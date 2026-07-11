package common

import (
	"context"
	"errors"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// RetryConfig holds configuration for retry behavior
type RetryConfig struct {
	MaxRetries    int              // Maximum number of retry attempts (default: 3)
	InitialDelay  time.Duration    // Initial delay before first retry (default: 500ms)
	MaxDelay      time.Duration    // Maximum delay cap (default: 30s)
	RetryableFunc func(error) bool // Predicate to determine if error is retryable (default: all errors retryable)
}

// RetryOption is a functional option for configuring retry behavior
type RetryOption func(*RetryConfig)

// WithMaxRetries sets the maximum number of retry attempts
func WithMaxRetries(maxRetries int) RetryOption {
	return func(c *RetryConfig) {
		c.MaxRetries = maxRetries
	}
}

// WithInitialDelay sets the initial delay before first retry
func WithInitialDelay(delay time.Duration) RetryOption {
	return func(c *RetryConfig) {
		c.InitialDelay = delay
	}
}

// WithMaxDelay sets the maximum delay cap
func WithMaxDelay(maxDelay time.Duration) RetryOption {
	return func(c *RetryConfig) {
		c.MaxDelay = maxDelay
	}
}

// WithRetryableFunc sets a custom predicate to determine if an error is retryable
func WithRetryableFunc(fn func(error) bool) RetryOption {
	return func(c *RetryConfig) {
		c.RetryableFunc = fn
	}
}

// Retry executes the given function with retry logic using exponential backoff.
// It supports context cancellation and configurable retry behavior.
//
// Parameters:
//   - ctx: Context for cancellation support
//   - fn: The function to execute
//   - opts: Optional retry configuration
//
// Returns:
//   - error: The last error encountered, or nil if successful
//
// Example:
//
//	err := common.Retry(ctx, func() error {
//	    return someOperation()
//	}, common.WithMaxRetries(5), common.WithInitialDelay(time.Second))
func Retry(ctx context.Context, fn func() error, opts ...RetryOption) error {
	// Default configuration
	config := &RetryConfig{
		MaxRetries:    3,
		InitialDelay:  500 * time.Millisecond,
		MaxDelay:      30 * time.Second,
		RetryableFunc: func(err error) bool { return true }, // Default: all errors retryable
	}

	// Apply functional options
	for _, opt := range opts {
		opt(config)
	}

	var lastErr error

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		// Check context cancellation before each attempt
		if ctx.Err() != nil {
			if lastErr != nil {
				return errors.Join(ctx.Err(), lastErr)
			}
			return ctx.Err()
		}

		// Execute the function
		err := fn()
		if err == nil {
			return nil // Success
		}

		lastErr = err

		// Check if this was the last attempt
		if attempt == config.MaxRetries {
			break
		}

		// Check if error is retryable
		if !config.RetryableFunc(err) {
			logger.SysLogf("Retry: non-retryable error encountered: %v", err)
			return err
		}

		// Calculate exponential backoff delay
		delay := calculateBackoff(attempt, config.InitialDelay, config.MaxDelay)

		logger.SysLogf("Retry: attempt %d/%d failed, retrying in %v: %v",
			attempt+1, config.MaxRetries, delay, err)

		// Wait with context awareness
		select {
		case <-ctx.Done():
			if lastErr != nil {
				return errors.Join(ctx.Err(), lastErr)
			}
			return ctx.Err()
		case <-time.After(delay):
			// Continue to next retry
		}
	}

	return lastErr
}

// calculateBackoff calculates the exponential backoff delay with a maximum cap
func calculateBackoff(attempt int, initialDelay, maxDelay time.Duration) time.Duration {
	// Exponential backoff: initialDelay * 2^attempt
	delay := initialDelay << attempt
	if delay > maxDelay {
		delay = maxDelay
	}
	return delay
}
