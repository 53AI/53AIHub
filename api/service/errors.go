package service

import "errors"

var (
    ErrApprovalAlreadyApplied   = errors.New("approval already applied")
    ErrApprovalAlreadyProcessed = errors.New("approval already processed")
    ErrForbiddenNotManager      = errors.New("forbidden: not a manager")
)
