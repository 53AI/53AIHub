package weboffice

import (
	"fmt"
	"net/http"
)

type Code int

const (
	OK Code = 0
)

var (
	ErrUnauthorized         = &Error{code: 40002, statusCode: http.StatusUnauthorized, message: "unauthorized"}
	ErrPermissionDenied     = &Error{code: 40003, statusCode: http.StatusForbidden, message: "permission denied"}
	ErrFileNotExists        = &Error{code: 40004, statusCode: http.StatusForbidden, message: "file not exists"}
	ErrInvalidArguments     = &Error{code: 40005, statusCode: http.StatusForbidden, message: "invalid arguments"}
	ErrSpaceFull            = &Error{code: 40006, statusCode: http.StatusForbidden, message: "space full"}
	ErrFileNameConflict     = &Error{code: 40008, statusCode: http.StatusForbidden, message: "filename conflict"}
	ErrFileVersionNotExists = &Error{code: 40009, statusCode: http.StatusForbidden, message: "file version not exists"}
	ErrUserNotExists        = &Error{code: 40010, statusCode: http.StatusForbidden, message: "user not exists"}
	ErrInternalError        = &Error{code: 50001, statusCode: http.StatusInternalServerError, message: "internal error"}
)

type Error struct {
	code       Code
	statusCode int
	message    string
}

func (err *Error) Code() Code {
	return err.code
}

func (err *Error) StatusCode() int {
	return err.statusCode
}

func (err *Error) Message() string {
	return err.message
}
func (err *Error) WithMessage(msg string) *Error {
	clone := *err
	err.message = msg
	return &clone
}

func (err *Error) Error() string {
	return fmt.Sprintf("code:%d message:%s", err.code, err.message)
}

/*
func NewError(code Code) *Error {
	return &Error{code: code}
}
*/

func NewCustomError(message string) *Error {
	return &Error{code: 40007, message: message}
}
