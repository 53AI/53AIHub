package model

import "errors"

// CommonResponse represents the standard API response format
// @Description Standard API response structure
// @Description Code: Status code of the response
// @Description Message: Human-readable message about the response
// @Description Data: Actual response data, can be any type
type CommonResponse struct {
	// @Description Status code, see ResponseCode enum for details
	// @Enum 0:Success - Operation completed successfully
	// @Enum 1:ParamError - Invalid parameters provided
	// @Enum 2:DBError - Database operation failed
	// @Enum 3:NetworkError - Network communication error
	// @Enum 4:SystemError - Internal system error
	// @Enum 5:AuthFailed - Authentication failure
	// @Enum 6:NotFound - Resource not found
	// @Enum 7:UnauthorizedError - Unauthorized access
	// @Enum 8:FileError - File operation failed
	// @Enum 9:ForbiddenError - Forbidden access
	// @Enum 10:AgentAuthError - Agent authentication failed
	// @Enum 11:TokenExpiredError - Token expired, need to re-login
	// @Enum 12:ChatError - Chat operation failed
	// @Enum 13:ProviderNoFoundError - Provider not found
	Code    int         `json:"code" example:"0" enums:"0,1,2,3,4,5,6,7,8,9,10,11,12,13"`
	Message string      `json:"message" example:"ok" description:"Response message"`
	Data    interface{} `json:"data" description:"Response data payload"`
}

type OpenAIError struct {
	Message string      `json:"message"`
	Type    string      `json:"type"`
	Param   interface{} `json:"param,omitempty"`
	Code    interface{} `json:"code,omitempty"`
}

type OpenAIErrorResponse struct {
	Error OpenAIError `json:"error"`
}

// ResponseCode defines the status codes used in API responses
// @Description Enumeration of all possible response status codes
type ResponseCode int

// Response code enumeration
// @enum ResponseCode
const (
	Success                      ResponseCode = iota // 0 - Success
	ParamError                                       // 1 - Invalid parameters
	DBError                                          // 2 - Database operation failed
	NetworkError                                     // 3 - Network communication error
	SystemError                                      // 4 - Internal system error
	AuthFailed                                       // 5 - Authentication failure
	NotFound                                         // 6 - Resource not found
	UnauthorizedError                                // 7 - Unauthorized access
	FileError                                        // 8 - File operation failed
	ForbiddenError                                   // 9 - Forbidden access
	AgentAuthError                                   // 10 - Agent authentication failed
	TokenExpiredError                                // 11 - Token expired, need to re-login
	ChatError                                        // 12 - Chat operation failed
	ProviderNoFoundError                             // 13 - Provider not found
	OperateTooFast                                   // 14 - Operate too fast
	FeatureNotAvailableError                         // 15 - Feature not available
	RecordAlreadyExists                              // 16 - Record already exists
	InvalidVerificationCodeError                     // 17 - 验证码错误
)

// Response code descriptions
// @Description Mapping of response codes to their human-readable messages
// @Description This map provides the default message for each response code
// @Description Used by the Message() method to get the standard message for a code
var CodeMessage = map[ResponseCode]string{
	Success:                      "ok",
	ParamError:                   "param error",
	DBError:                      "db error",
	NetworkError:                 "network error",
	SystemError:                  "system error",
	AuthFailed:                   "auth failed",
	NotFound:                     "not found",
	UnauthorizedError:            "unauthorized",
	FileError:                    "file error",
	ForbiddenError:               "forbidden",
	AgentAuthError:               "agent auth failed",
	TokenExpiredError:            "token expired",
	ChatError:                    "chat error",
	ProviderNoFoundError:         "provider not found",
	OperateTooFast:               "operate too fast",
	FeatureNotAvailableError:     "feature not available",
	RecordAlreadyExists:          "record already exists",
	InvalidVerificationCodeError: "invalid or expired verification code",
}

const (
	InvalidEnterpriseID     = "invalid enterprise id"
	InvalidVerificationCode = "invalid or expired verification code"
	InvalidMobileOrEmail    = "invalid mobile number or email format"
	InvalidMobileFormat     = "invalid mobile number format"
	PasswordNotMatch        = "password not match"
	OrderNotFound           = "order not found"
	FeatureNotAvailable     = "feature not available"
	FeatureOverLimit        = "feature over limit"
)

func (c ResponseCode) Message() string {
	if msg, ok := CodeMessage[c]; ok {
		return msg
	}
	return "system error"
}

func (c ResponseCode) ToResponse(data interface{}) CommonResponse {
	if err, ok := data.(error); ok {
		return c.ToErrorResponse(err)
	}
	return CommonResponse{
		Code:    int(c),
		Message: c.Message(),
		Data:    data,
	}
}

func (c ResponseCode) ToErrorResponse(err error) CommonResponse {
	return CommonResponse{
		Code:    int(c),
		Message: c.Message() + ": " + err.Error(),
		Data:    nil,
	}
}

func (c ResponseCode) ToNewErrorResponse(message string) CommonResponse {
	err := errors.New(message)
	return CommonResponse{
		Code:    int(c),
		Message: c.Message() + ": " + err.Error(),
		Data:    nil,
	}
}

func (c ResponseCode) ToOpenAIErrorRespone(data interface{}) OpenAIErrorResponse {
	msg := c.Message()
	if err, ok := data.(error); ok {
		msg += ": " + err.Error()
	}
	// data if str
	if str, ok := data.(string); ok {
		msg += ": " + str
	}

	return OpenAIErrorResponse{
		Error: OpenAIError{
			Message: msg,
			Type:    "53aihub_error",
		},
	}
}
