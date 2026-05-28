package relay

import (
	"encoding/json"
	"net/http"

	hubmodel "github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

// writeStreamOpenAIError writes OpenAI-style errors in SSE format for stream requests.
// This keeps response framing consistent with "data: ...\n\n" contract.
func writeStreamOpenAIError(c *gin.Context, statusCode int, errResp hubmodel.OpenAIErrorResponse) {
	if statusCode <= 0 {
		statusCode = http.StatusInternalServerError
	}

	SetUpStreamResponseHeaders(c)
	if !c.Writer.Written() {
		c.Writer.WriteHeader(statusCode)
	}

	payload, err := json.Marshal(errResp)
	if err != nil {
		payload = []byte(`{"error":{"message":"internal error","type":"53aihub_error"}}`)
	}

	_, _ = c.Writer.Write([]byte("data: "))
	_, _ = c.Writer.Write(payload)
	_, _ = c.Writer.Write([]byte("\n\n"))
	_, _ = c.Writer.Write([]byte("data: [DONE]\n\n"))

	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

func openAIErrorResponseFromRelayError(errResp *relay_model.ErrorWithStatusCode) hubmodel.OpenAIErrorResponse {
	if errResp == nil {
		return hubmodel.OpenAIErrorResponse{
			Error: hubmodel.OpenAIError{
				Message: "unknown relay error",
				Type:    "53aihub_error",
			},
		}
	}
	errType := errResp.Type
	if errType == "" {
		errType = "53aihub_error"
	}
	message := errResp.Message
	if message == "" {
		message = "unknown relay error"
	}
	return hubmodel.OpenAIErrorResponse{
		Error: hubmodel.OpenAIError{
			Message: message,
			Type:    errType,
			Param:   errResp.Param,
			Code:    errResp.Code,
		},
	}
}
