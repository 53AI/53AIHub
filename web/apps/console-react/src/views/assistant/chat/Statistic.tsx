import React from "react";
import { Record } from "@/views/search/record/Record";

interface StatisticProps {
  agentId?: string | number;
}

export default function Statistic({ agentId }: StatisticProps) {
  if (!agentId) return null;

  return (
    <div className="h-full overflow-y-auto">
      <Record agentId={agentId} />
    </div>
  );
}
