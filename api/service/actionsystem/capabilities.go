package actionsystem

const (
	CapabilityDeepResearch       = "deep_research"
	CapabilityEnterpriseContext  = "enterprise_context_read"
	CapabilityDocumentGeneration = "document_generation"
)

func DefaultCapabilityRegistry(deepResearchVerified bool) StaticCapabilityRegistry {
	deepResearch := Capability{
		Key:    CapabilityDeepResearch,
		Label:  "公开资料深度研究",
		Status: CapabilityUnverified,
		Reason: "尚未通过 Golden Case 的真实来源、交叉验证和引用验收",
	}
	if deepResearchVerified {
		deepResearch.Status = CapabilityAvailable
		deepResearch.Reason = "已通过当前部署环境的 Deep Research Golden Case 验收"
	}
	return NewStaticCapabilityRegistry(
		Capability{
			Key:    CapabilityEnterpriseContext,
			Label:  "读取 Host 提供的企业上下文",
			Status: CapabilityAvailable,
		},
		Capability{
			Key:    CapabilityDocumentGeneration,
			Label:  "生成并交付文档",
			Status: CapabilityAvailable,
		},
		deepResearch,
	)
}
