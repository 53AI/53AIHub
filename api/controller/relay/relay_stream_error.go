package relay

import (
	"encoding/json"
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// writeStreamOpenAIError writes OpenAI-style errors in SSE format for stream requests.
// This keeps response framing consistent with "data: ...\n\n" contract.
func writeStreamOpenAIError(c *gin.Context, statusCode int, errResp model.OpenAIErrorResponse) {
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
