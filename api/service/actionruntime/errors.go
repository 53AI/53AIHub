package actionruntime

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	ErrorCodeBinaryMissing   ErrorCode = "binary_missing"
	ErrorCodeReadyTimeout    ErrorCode = "ready_timeout"
	ErrorCodeRunTimeout      ErrorCode = "run_timeout"
	ErrorCodeAuthFailed      ErrorCode = "auth_failed"
	ErrorCodeProxyFailed     ErrorCode = "proxy_failed"
	ErrorCodeProtocolFailed  ErrorCode = "protocol_error"
	ErrorCodeRuntimeExited   ErrorCode = "runtime_exit"
	ErrorCodeCancelled       ErrorCode = "cancelled"
	ErrorCodeOutputLimit     ErrorCode = "output_limit_exceeded"
	ErrorCodeVersionMismatch ErrorCode = "version_mismatch"

	// 交付协议（ResultSpec）分级错误：缺输出 / 解析失败 / 语义校验失败 / 渲染失败
	ErrorCodeResultSpecMissing    ErrorCode = "result_spec_missing"
	ErrorCodeResultSpecParse      ErrorCode = "result_spec_parse_failed"
	ErrorCodeResultSpecValidation ErrorCode = "result_spec_validation_failed"
	ErrorCodeResultRender         ErrorCode = "result_render_failed"
	ErrorCodeStatusConflict       ErrorCode = "run_status_conflict"
	// ErrorCodeApprovalUnavailable：运行中出现无法自动授予的授权请求（V1 fail-closed）。
	ErrorCodeApprovalUnavailable ErrorCode = "approval_unavailable"

	// 主交付物交付失败：没找到约定的文件 / 候选不唯一 / 真实格式不对。
	ErrorCodeExpectedArtifactMissing ErrorCode = "expected_artifact_missing"
	ErrorCodeArtifactAmbiguous       ErrorCode = "artifact_ambiguous"
	ErrorCodeArtifactFormatMismatch  ErrorCode = "artifact_format_mismatch"
	ErrorCodeUnknown                 ErrorCode = "runtime_error"
)

type RuntimeError struct {
	Stage string
	Code  ErrorCode
	Err   error
}

func (e *RuntimeError) Error() string {
	if e == nil {
		return "runtime error"
	}
	return fmt.Sprintf("%s failed (%s): %v", e.Stage, e.Code, e.Err)
}

func (e *RuntimeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func NewRuntimeError(stage string, code ErrorCode, err error) error {
	if err == nil {
		err = errors.New(string(code))
	}
	if code == "" {
		code = ErrorCodeUnknown
	}
	return &RuntimeError{Stage: stage, Code: code, Err: err}
}

func RuntimeErrorCode(err error) ErrorCode {
	var runtimeErr *RuntimeError
	if errors.As(err, &runtimeErr) && runtimeErr != nil {
		return runtimeErr.Code
	}
	return ""
}

// ResultSpecErrorCode maps a delivery-contract failure onto its stable code so an
// operator can tell "no output" from "malformed" from "incomplete" from "renderer".
func ResultSpecErrorCode(err error) ErrorCode {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrResultSpecMissing):
		return ErrorCodeResultSpecMissing
	case errors.Is(err, ErrResultSpecParse):
		return ErrorCodeResultSpecParse
	case errors.Is(err, ErrResultSpecValidation):
		return ErrorCodeResultSpecValidation
	default:
		return ErrorCodeResultRender
	}
}
