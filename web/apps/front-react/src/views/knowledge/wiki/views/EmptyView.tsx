import React from "react";
import { Empty } from "antd";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";

interface EmptyViewProps {
  type?: "dynamic" | "graph";
  /** 自定义标题（优先级高于 type 默认值） */
  title?: string;
  /** 自定义描述（优先级高于 type 默认值） */
  description?: string;
}

const TYPE_I18N_KEY: Record<
  NonNullable<EmptyViewProps["type"]>,
  { title: string; description: string }
> = {
  dynamic: {
    title: "dynamic_knowledge.empty_title",
    description: "dynamic_knowledge.empty_desc",
  },
  graph: {
    title: "dynamic_knowledge.empty_graph_title",
    description: "dynamic_knowledge.empty_graph_desc",
  },
};

/**
 * 空态视图：功能未启用或无数据时显示
 */
const EmptyView: React.FC<EmptyViewProps> = ({
  type = "dynamic",
  title,
  description,
}) => {
  const config = TYPE_I18N_KEY[type];
  const displayTitle = title ?? t(config.title);
  const displayDesc = description ?? t(config.description);

  return (
    <Empty
      styles={{ image: { height: 100 } }}
      image={getPublicPath("/images/empty.png")}
      description={
        <>
          <p className="text-base text-primary">{displayTitle}</p>
          {displayDesc && (
            <p className="text-sm text-placeholder mt-1">{displayDesc}</p>
          )}
        </>
      }
    />
  );
};

export default EmptyView;
