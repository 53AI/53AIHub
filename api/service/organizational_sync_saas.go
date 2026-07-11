//go:build saas

package service

import (
	"fmt"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/saas/saas_dingtalk"
	"github.com/53AI/53AIHub/saas/saas_wecom"
)

func runWeComSyncOrganization(e *model.Enterprise, params SyncOrganizationParams) error {
	suiteID := config.GetWecomSuiteID()
	if suiteID == "" {
		return fmt.Errorf("wecom suite_id is empty")
	}
	if e == nil || e.Eid == 0 {
		return fmt.Errorf("enterprise is invalid")
	}
	if e.WecomCorpID == "" {
		return fmt.Errorf("wecom corp_id is empty")
	}
	wc, err := model.GetWecomCorp(suiteID, e.WecomCorpID)
	if err != nil {
		return err
	}
	if wc == nil {
		return fmt.Errorf("wecom corp not found")
	}
	return (&saas_wecom.SyncOrganizational{Wc: wc, E: e}).Run()
}

func runDingtalkSyncOrganization(e *model.Enterprise, params SyncOrganizationParams) error {
	suiteID := params.SuiteID
	if suiteID == "" {
		suiteID = config.GetDingtalkSuiteID()
	}
	if suiteID == "" {
		return fmt.Errorf("dingtalk suite_id is empty")
	}
	if e == nil || e.Eid == 0 {
		return fmt.Errorf("enterprise is invalid")
	}
	if e.DingtalkCorpID == "" {
		return fmt.Errorf("dingtalk corp_id is empty")
	}
	dc, err := model.GetDingtalkCorp(suiteID, e.DingtalkCorpID)
	if err != nil {
		return err
	}
	if dc == nil {
		return fmt.Errorf("dingtalk corp not found")
	}
	return (&saas_dingtalk.SyncOrganizational{Dc: dc, E: e}).Run()
}

