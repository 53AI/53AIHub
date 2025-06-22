package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// GetCozeAllWorkspaces Get all Coze workspaces
// @Summary Get all Coze workspaces
// @Description Get all Coze workspaces list under current enterprise
// @Tags Coze
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]coze.Workspace}
// @Router /api/coze/workspaces [get]
func GetCozeAllWorkspaces(c *gin.Context) {
	eid := config.GetEID(c)
	provider, err := model.GetFirstProviderByEidAndProviderType(eid, int64(model.ProviderTypeCozeCn))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	ser := service.CozeService{
		Provider: provider,
	}

	workspaces, err := ser.GetAllWorkspace()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(workspaces))
}

// GetCozeAllBots Get all bots in specified workspace
// @Summary Get workspace bots list
// @Description Get all bots list under specified Coze workspace
// @Tags Coze
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param workspace_id path string true "Workspace ID"
// @Success 200 {object} model.CommonResponse{data=[]coze.Bot}
// @Router /api/coze/workspaces/{workspace_id}/bots [get]
func GetCozeAllBots(c *gin.Context) {
	workspaceID := c.Param("workspace_id")
	if workspaceID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	provider, err := model.GetFirstProviderByEidAndProviderType(eid, int64(model.ProviderTypeCozeCn))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}
	ser := service.CozeService{
		Provider: provider,
	}
	bots, err := ser.GetAllBot(workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	var botIds []string
	for _, bot := range bots {
		botIds = append(botIds, bot.BotID)
	}

	ser.UpdateCozeChannel(botIds)

	c.JSON(http.StatusOK, model.Success.ToResponse(bots))
}
