import { useEffect, useState } from "react";
import { Spin } from "antd";
import Record from "./Record";
import agentsApi from "@/api/modules/agents/index";
import { AGENT_USAGES } from "@/constants/agent";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import type { AgentInfo } from "@/api/modules/agents/index";

export function SearchRecordPage() {
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAgent = async () => {
    const result = await agentsApi.list({ agent_usages: AGENT_USAGES.KM_AI_SEARCH });
    setAgentInfo(result.agents[0] ? transformAgentInfo(result.agents[0]) : null);
    setLoading(false);
  };

  useEffect(() => {
    loadAgent();
  }, []);

  return (
    <div className="bg-white h-full overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Spin spinning={loading} />
        </div>
      ) : (
        <Record agentId={agentInfo?.agent_id} />
      )}
    </div>
  );
}

export default SearchRecordPage;
