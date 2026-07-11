/**
 * LibraryChatView — /library/:id/chat 路由胶水
 *
 * 职责:
 * 1. 优先复用 store.agentList 中已有的 agent_usage=KM_AI_SEARCH 且 is_system=true 的 agent
 * 2. 否则调用 useAgentStore.getState().loadAgentList() 拉取,找到目标后注入 agentList
 * 3. 调用 convStore.setCurrentState(agent_id, '', false) 触发会话加载
 * 4. 渲染 <ChatContainer agentId=... />,复用 KM_AI_SEARCH sender、ThinkKnowledge
 *    侧栏、推荐问题、反馈、收藏、分享等行为
 * 5. 无目标 agent 或失败 → navigate('/agent', { replace: true })
 *
 * 注意:不用 <ChatView />,因为它内部 useEffect 会回退到 explore 列表第一个 agent,
 *       会覆盖这里注入的 KM_AI_SEARCH。
 *
 * 注意:只查 agentList(系统级智能体),不查 myAgentList(用户自添加)。
 */

import { Spin } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGENT_USAGES } from "@/constants/agent";
import { useAgentStore, useCurrentAgent } from "@/stores/modules/agent";
import { useConversationStore } from "@/stores/modules/conversation";
import type { Agent } from "@/types/agent";
import ChatContainer from "./ChatContainer";

type Phase = "loading" | "ready" | "missing" | "error";

/**
 * 从 agentStore.agentList 中查找指定 usage 且 is_system=true 的系统级智能体。
 * 不查 myAgentList —— /library/:id/chat 是系统级 KM_AI_SEARCH agent,
 * 由后端 agentList 接口维护,与"我的智能体"无关。
 */
function findSystemAgentByUsage(usage: number) {
	const state = useAgentStore.getState() as unknown as {
		agentList: Agent.State[];
	};
	return state.agentList.find(
		(item: Agent.State) =>
			item.agent_usage === usage &&
			(item as unknown as { is_system?: boolean }).is_system === true,
	);
}

function injectAgentToStore(agent: Agent.State) {
	useAgentStore.setState((state: any) => ({
		agentList: [
			agent,
			...state.agentList.filter(
				(a: Agent.State) => String(a.agent_id) !== String(agent.agent_id),
			),
		],
	}));
}

export function LibraryChatView() {
	const navigate = useNavigate();
	const convStore = useConversationStore();
	const currentAgent = useCurrentAgent();
	const [phase, setPhase] = useState<Phase>("loading");

	useEffect(() => {
		let cancelled = false;

		const resolve = async () => {
			// 1) 缓存命中:agentList 中已有 is_system=true 且 usage=KM_AI_SEARCH 的 agent
			const cached = findSystemAgentByUsage(AGENT_USAGES.KM_AI_SEARCH);
			if (cached) {
				convStore.setCurrentState(String(cached.agent_id), "", false);
				if (!cancelled) setPhase("ready");
				return;
			}

			// 2) 走 agentStore.loadAgentList 拉取(带缓存,不会重复请求)
			try {
				const list = await useAgentStore.getState().loadAgentList();
				if (cancelled) return;
				// 重新查一次(loadAgentList 写入 store 后)
				const found =
					findSystemAgentByUsage(AGENT_USAGES.KM_AI_SEARCH) ||
					list.find(
						(item) =>
							item.agent_usage === AGENT_USAGES.KM_AI_SEARCH &&
							(item as unknown as { is_system?: boolean }).is_system === true,
					);
				if (!found) {
					setPhase("missing");
					return;
				}
				injectAgentToStore(found);
				convStore.setCurrentState(String(found.agent_id), "", false);
				setPhase("ready");
			} catch (err) {
				console.error("Failed to load KM_AI_SEARCH agent:", err);
				if (!cancelled) setPhase("error");
			}
		};

		resolve();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [convStore.setCurrentState]);

	// missing/error：跳到 /agent
	useEffect(() => {
		if (phase === "missing" || phase === "error") {
			navigate("/agent", { replace: true });
		}
	}, [phase, navigate]);

	if (phase !== "ready" || !currentAgent?.agent_id) {
		return (
			<div className="flex items-center justify-center w-full h-full">
				<Spin size="large" />
			</div>
		);
	}

	return (
		<ChatContainer
			agentId={String(currentAgent.agent_id)}
			isIndexRoute={true}
			className="flex-1"
		/>
	);
}

export default LibraryChatView;
