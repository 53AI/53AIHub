package sandboxruntime

import "fmt"

var (
	ErrInvalidPath     = fmt.Errorf("invalid sandbox path")
	ErrSessionRequired = fmt.Errorf("session is required")
)
