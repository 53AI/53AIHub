//go:build !saas

package router

import "github.com/gin-gonic/gin"

func maybeUseSaasEnv(apiRouter *gin.RouterGroup) {}

