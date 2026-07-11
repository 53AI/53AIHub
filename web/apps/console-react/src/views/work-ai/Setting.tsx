import { DeleteOutlined, RightOutlined } from "@ant-design/icons";
import { XBubbleAssistant, XBubbleList, XBubbleUser } from "@km/hub-ui-x-react";
import {
	ChatConfigProvider,
	Chunk,
	type ChunkRef,
	Quotation,
	ThinkKnowledge,
	type ThinkKnowledgeRef,
} from "@km/shared-business/chat";
import { SvgIcon } from "@km/shared-components-react";
import { Button, Divider, Input, message, Spin } from "antd";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AgentInfo } from "@/api/modules/agents/index";
import agentsApi from "@/api/modules/agents/index";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import chunksApi from "@/api/modules/chunks";
import { skillApi } from "@/api/modules/skill";
import RagHeader from "@/components/Chat/RagHeader";
import Sender from "@/components/Chat/Sender";
import SpecifiedFiles from "@/components/Chat/SpecifiedFiles";
import { KnowledgeViewDrawer } from "@/components/Knowledge/view-drawer";
import ModelSelectPopover from "@/components/Model/select-popover";
import ModelView from "@/components/Model/view";
import ResourcePicker from "@/components/ResourcePicker/index";
import { AGENT_USAGES } from "@/constants/agent";
import { VERSION_MODULE } from "@/constants/enterprise";
import { GROUP_TYPE } from "@/constants/group";
import { MODEL_USE_TYPE } from "@/constants/platform/config";
import { useVersion } from "@/hooks";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useChatSend } from "@/hooks/useChatSend";
import { useEnv } from "@/hooks/useEnv";
import { useConversationStore } from "@/stores";
import { useUserStore } from "@/stores/modules/user";
import { assign, deepCopy } from "@/utils";
import { getPublicPath } from "@/utils/config";
import "./Setting.scss";

interface SettingProps {
	onAgentChange?: (agent: AgentInfo) => void;
	onLoading?: (loading: boolean) => void;
}

const DEFAULT_SETTINGS = {
	name: "工作台",
	logo: "",
	description: "",
	model: "",
	enable: true,
	agent_type: 0,
	channel_type: 0,
	prompt:
		"你是一个全能的数字员工。你不仅能回答问题，还能使用浏览器、代码解释器等工具自主完成复杂任务。面对任务时，请先进行规划(Plan)，然后逐步执行(Execute)，并在每一步后进行观察(0bserve)和反思(Reflect)。",
	sort: 0,
	configs: {
		completion_params: {
			temperature: 0.2,
			top_p: 0.75,
			presence_penalty: 0.5,
			frequency_penalty: 0.5,
		},
	},
	tools: [],
	use_cases: [],
	custom_config: {
		agent_type: "prompt",
		provider_id: 0,
		channel_id: 0,
		channel_config: {},
		file_parse: { enable: false },
		image_parse: { enable: false },
		agent_mode: "chat",
		skills: [] as Array<{ label: string; value?: string; skill_id?: string }>,
	},
	settings: {
		opening_statement:
			typeof window !== "undefined" && (window as any).$t
				? (window as any).$t("work_ai.default_opening_statement")
				: "下午好，希望我为你做些什么？",
		fast_reasoning_config: {
			enable: true,
			channel_id: 0,
			channel_type: 0,
			model_name: "",
			temperature: 0.7,
		},
		skill_run_config: {
			enable: true,
			channel_id: 0,
			channel_type: 0,
			model_name: "",
			temperature: 0.7,
		},
		skills: [] as any,
	},
	agent_usage: AGENT_USAGES.WORK_AI,
};

const WorkAISetting: React.FC<SettingProps> = ({
	onAgentChange,
	onLoading,
}) => {
	const t = (window as any).$t || ((key: string) => key);
	const userStore = useUserStore();
	const conversationStore = useConversationStore();
	const { canUse: canUseKnowledgeBase } = useVersion({
		module: VERSION_MODULE.KNOWLEDGE_BASE,
	});
	const { buildFrontLibraryFileUrl } = useEnv();

	const [isLoading, setIsLoading] = useState(true);
	const [form, setForm] = useState<any>(deepCopy(DEFAULT_SETTINGS));
	const [agentInfo, setAgentInfo] = useState<any | null>(null);
	const [agentModels, setAgentModels] = useState<any[]>([]);
	const [originalModelConfig, setOriginalModelConfig] = useState({
		fast_reasoning: {
			channel_id: 0,
			model_name: "",
			channel_type: 0,
		},
		skill_run: {
			channel_id: 0,
			model_name: "",
			channel_type: 0,
		},
	});

	const chunkRef = useRef<ChunkRef>(null);
	const thinkKnowledgeRef = useRef<ThinkKnowledgeRef>(null);
	const chunkSourceRef = useRef<any>(null);

	const {
		state: messageState,
		messageListRef,
		renderSource,
		handleSourceReferenceHover: handleSourceReferenceHoverBase,
		handleOpenKnow: handleOpenKnowBase,
		addMessage,
		forceUpdate,
	} = useChatMessages({ limit: 10 });
	const { sendMessage: sendMessageBase, handleStop: handleStopBase } =
		useChatSend();

	const is_internal = useMemo(
		() => userStore.info.type === 2,
		[userStore.info.type],
	);
	const messageList = useMemo(
		() => messageState.messageList,
		[messageState.messageList],
	);

	const [state, setState] = useState({
		isStreaming: false,
		library: {
			name:
				typeof window !== "undefined" && (window as any).$t
					? (window as any).$t("all_knowledge_base")
					: "全部知识库",
			value: ["all"],
			isSpace: false,
		},
		model: "",
		showHistory: false,
		showThinkKnowledge: false,
		networkSearch: false,
		selectedSkills: [] as Array<{
			display_name: string;
			skill_name?: string;
		}>,
		selectedExampleId: "",
	});

	// 技能库列表（ResourcePicker 会通过 v-model 更新此列表）
	const [skillLibraryList, setSkillLibraryList] = useState<any[]>([]);
	// 有效技能ID集合（用于过滤已删除/禁用的技能）
	const [allSkillIds, setAllSkillIds] = useState<Set<number>>(new Set());
	// 我的技能列表
	const [mySkillList, setMySkillList] = useState<any[]>([]);

	// 规划推理模型值 (computed getter + setter)
	const fastReasoningValue = useMemo(() => {
		const { channel_id, model_name, channel_type } =
			form.settings.fast_reasoning_config;
		return channel_id && model_name && channel_type
			? `${channel_id}_53aikm_${model_name}_53aikm_${channel_type}`
			: "";
	}, [form.settings.fast_reasoning_config]);

	const setFastReasoningValue = useCallback((value: string) => {
		const [channel_id, model_name, channel_type] = value.split("_53aikm_");
		setForm((prev: any) => ({
			...prev,
			settings: {
				...prev.settings,
				fast_reasoning_config: {
					...prev.settings.fast_reasoning_config,
					channel_id: Number(channel_id),
					model_name,
					channel_type: Number(channel_type),
				},
			},
		}));
	}, []);

	// 技能执行模型值 (computed getter + setter)
	const skillRunValue = useMemo(() => {
		const { channel_id, model_name, channel_type } =
			form.settings.skill_run_config;
		return channel_id && model_name && channel_type
			? `${channel_id}_53aikm_${model_name}_53aikm_${channel_type}`
			: "";
	}, [form.settings.skill_run_config]);

	const setSkillRunValue = useCallback((value: string) => {
		const [channel_id, model_name, channel_type] = value.split("_53aikm_");
		setForm((prev: any) => ({
			...prev,
			settings: {
				...prev.settings,
				skill_run_config: {
					...prev.settings.skill_run_config,
					channel_id: Number(channel_id),
					model_name,
					channel_type: Number(channel_type),
				},
			},
		}));
	}, []);

	const currentModel = useMemo(() => {
		return agentModels.find((item) => item.value === state.model);
	}, [agentModels, state.model]);

	const hasModelConfigChanges = useMemo(() => {
		const fast = form.settings.fast_reasoning_config;
		const skill = form.settings.skill_run_config;
		const origFast = originalModelConfig.fast_reasoning;
		const origSkill = originalModelConfig.skill_run;

		return (
			fast.channel_id !== origFast.channel_id ||
			fast.model_name !== origFast.model_name ||
			fast.channel_type !== origFast.channel_type ||
			skill.channel_id !== origSkill.channel_id ||
			skill.model_name !== origSkill.model_name ||
			skill.channel_type !== origSkill.channel_type
		);
	}, [form.settings, originalModelConfig]);

	// 过滤掉不存在于技能库中的技能
	const selectedSkills = useMemo(() => {
		return (form.settings.skills || []).filter((skill: any) => {
			const skillId = skill.skill_id;
			return skillId && allSkillIds.has(skillId);
		});
	}, [form.settings.skills, allSkillIds]);

	// 技能选择确认
	const handleSkillConfirm = (result: { value: any[] }) => {
		if (!result.value || result.value.length === 0) return;

		result.value.forEach((skill) => {
			// 避免重复添加
			const skillId = skill.skill_id || skill.id;
			const exists = form.settings.skills.some(
				(s: any) => s.skill_id === skillId,
			);
			if (!exists) {
				setForm((prev: any) => ({
					...prev,
					settings: {
						...prev.settings,
						skills: [
							...prev.settings.skills,
							{
								skill_id: skillId,
								display_name: skill.display_name,
								skill_name: skill.skill_name,
							},
						],
					},
				}));
			}
		});

		// 同步更新 skillLibraryList（v-model 绑定的值）
		setSkillLibraryList(
			form.settings.skills.map((skill: any) => ({
				...skill,
				id: skill.skill_id,
				value: skill.skill_id,
				label: skill.display_name || skill.skill_name,
			})),
		);
	};

	// 技能移除
	const handleSkillRemove = (item: any) => {
		const index = form.settings.skills.findIndex(
			(s: any) => s.skill_id === item.skill_id,
		);
		if (index > -1) {
			setForm((prev: any) => {
				const newSkills = prev.settings.skills.filter(
					(_: any, i: number) => i !== index,
				);
				return {
					...prev,
					settings: {
						...prev.settings,
						skills: newSkills,
					},
				};
			});
		}
	};

	// 移除技能（聊天面板）
	const handleRemoveSkill = () => {
		setState((prev) => ({ ...prev, selectedSkills: [] }));
	};

	const handleSelectSkillFromMention = (skill: {
		label: string;
		icon: string;
	}) => {
		// 从我的技能列表中查找完整的技能信息
		const targetSkill = mySkillList.find(
			(s: any) => s.display_name === skill.label,
		);

		// 单选：替换为当前选中的技能
		setState((prev) => ({
			...prev,
			selectedSkills: [
				{
					display_name: skill.label,
					skill_name: targetSkill?.skill_name || "",
				},
			],
		}));
	};

	const handleFileClick = async (file: any) => {
		// File preview logic
	};

	// 共享 Chunk 组件的 chunk 详情获取回调
	const fetchChunkDetail = useCallback(async (chunkId: string) => {
		const res = await chunksApi.get(chunkId);
		return {
			content: res?.content || "",
			token_count: res?.token_count || 0,
			chunk_index: res?.chunk_index || 0,
		};
	}, []);

	const handleOpenKnow = (message: any) => {
		handleOpenKnowBase(message, thinkKnowledgeRef, (value: boolean) => {
			setState((prev) => ({ ...prev, showThinkKnowledge: value }));
		});
	};

	const handleSourceReferenceHover = (data: any, message: any) => {
		handleSourceReferenceHoverBase(data, message, chunkRef, chunkSourceRef);
	};

	// 当前会话ID
	const currentConversationId = useRef<number | null>(null);

	const createConversation = async (agent_id: number, question: string) => {
		// 如果已有会话ID，直接复用
		if (currentConversationId.current) {
			return currentConversationId.current;
		}
		const { data = {} } = await conversationStore.save({
			data: { agent_id, title: question },
		});
		currentConversationId.current = data.conversation_id;
		return data.conversation_id;
	};

	const sendMessage = async (
		question: string,
		links: any[] = [],
		files: any[] = [],
	) => {
		if (state.isStreaming) return;
		setState((prev) => ({
			...prev,
			showHistory: false,
			showThinkKnowledge: false,
			isStreaming: true,
		}));

		const agent_id = agentInfo?.agent_id;
		const conversation_id = await createConversation(agent_id, question);

		const completion_params = agentInfo?.configs.completion_params;
		const modelId = currentModel?.id || "";

		const selectedSkill = state.selectedSkills[0];

		try {
			await sendMessageBase({
				question,
				agent_id,
				conversation_id,
				modelId,
				completion_params: {
					...completion_params,
					temperature: currentModel?.temperature,
				},
				messageList: messageListRef.current,
				messageListRef,
				links,
				files,
				networkSearch: state.networkSearch,
				library: state.library,
				agentInfo: agentInfo,
				skill: {
					skill_name: selectedSkill?.skill_name || "",
					display_name: selectedSkill?.display_name || "",
				},
				type: "work-ai",
				onAddMessage: addMessage,
				onUpdateMessage: forceUpdate,
			});
			setState((prev) => ({ ...prev, selectedSkills: [] }));
		} catch (err: any) {
			console.log(err);
		} finally {
			setState((prev) => ({ ...prev, isStreaming: false }));
		}
	};

	const handleSend = (data: any) => {
		const { textContent, atList, files = [] } = data;
		if (!textContent.trim() && files.length === 0) return;
		if (!agentInfo || !agentInfo.agent_id) {
			message.warning(t("请先保存"));
			return;
		}
		if (hasModelConfigChanges) {
			message.warning(t("模型配置已修改，请先保存后再发送消息"));
			return;
		}
		sendMessage(textContent, atList || [], files);
	};

	const handleStop = () => {
		handleStopBase();
		setState((prev) => ({ ...prev, isStreaming: false }));
	};

	const handleShowErrorDetails = (message: any) => {
		if (!message.showErrorDetails) {
			message.showErrorDetails = true;
		}
	};

	const loadModels = async (agent: any) => {
		if (!agent.agent_id) return;
		const res = await agentsApi.models.list(agent.agent_id);
		const deepThinkingConfig = agent.settings.deep_thinking_config || {
			temperature: 0.5,
		};
		const fastReasoningConfig = agent.settings.fast_reasoning_config || {
			temperature: 0.5,
		};

		const models = res.agent_models
			.map((item: any) => {
				const isDeepThinking =
					item.channel_id === deepThinkingConfig.channel_id;
				const modelItem = {
					...item,
					type: isDeepThinking ? "deep_reasoning" : "fast_reasoning",
					icon: isDeepThinking ? "star-link" : "lightning",
					name: isDeepThinking ? "深度思考" : "快速回答",
					temperature: isDeepThinking
						? deepThinkingConfig.temperature
						: fastReasoningConfig.temperature,
					value: item.channel_id + "_" + item.channel_type + "_" + item.model,
				};
				return modelItem;
			})
			.filter(
				(item: any, index: number, self: any[]) =>
					index === self.findIndex((t) => t.type === item.type),
			);
		if (models.length) {
			setState((prev) => ({ ...prev, model: models[0].value }));
		}
		setAgentModels(models);
	};

	const modelsSave = async (agent_id: number) => {
		const fastConfig = form.settings.fast_reasoning_config;
		const skillConfig = form.settings.skill_run_config;
		const modelList = [];
		modelList.push({
			channel_id: fastConfig.channel_id,
			channel_type: fastConfig.channel_type,
			model: fastConfig.model_name,
		});
		modelList.push({
			channel_id: skillConfig.channel_id,
			channel_type: skillConfig.channel_type,
			model: skillConfig.model_name,
		});
		await agentsApi.models.batch({
			agent_id,
			models: modelList,
		});
	};

	const handleSave = async () => {
		const data = deepCopy(form);
		const fastValue = fastReasoningValue.split("_53aikm_");
		if (fastValue.length !== 3) {
			message.error(t("form_select_placeholder") + t("model.reasoning_v2"));
			return;
		}

		const skillValue = skillRunValue.split("_53aikm_");
		if (skillValue.length !== 3) {
			message.error(t("form_select_placeholder") + t("model.skill"));
			return;
		}

		data.channel_type = Number(fastValue[2]);
		data.model = fastValue[1];
		data.configs = JSON.stringify(data.configs);
		data.tools = JSON.stringify(data.tools);
		data.use_cases = JSON.stringify(data.use_cases);
		data.custom_config = JSON.stringify(data.custom_config);
		data.settings = JSON.stringify(data.settings);

		let agent_id = 0;
		if (form.agent_id) {
			agent_id = form.agent_id;
			await agentsApi.update(form.agent_id, data);
		} else {
			const result = await agentsApi.create(data);
			agent_id = result.agent_id;
		}
		setForm((prev: any) => ({ ...prev, agent_id }));
		agentInfo.agent_id = agent_id;
		await modelsSave(agent_id);
		await loadModels(agentInfo);

		setOriginalModelConfig({
			fast_reasoning: { ...form.settings.fast_reasoning_config },
			skill_run: { ...form.settings.skill_run_config },
		});
		message.success(t("action_save_success"));
	};

	const loadList = async () => {
		setIsLoading(true);
		onLoading?.(true);

		// 获取前台探索列表
		try {
			const { list = [] } = await skillApi.list({
				params: {
					offset: 0,
					limit: 100,
					publish_status: "published",
					admin_status: "enabled",
				},
			});
			setAllSkillIds(new Set(list.map((item: any) => item.id)));
		} catch (e) {
			console.error("error", e);
		}

		// 获取我的技能列表
		try {
			const res = await skillApi.getMyList({ limit: 100 });
			setMySkillList(res?.items || []);
		} catch (e) {
			console.error("error", e);
		}

		try {
			const result = await agentsApi.list({
				agent_usages: AGENT_USAGES.WORK_AI,
			});
			const agent = result.agents[0]
				? transformAgentInfo(result.agents[0])
				: deepCopy(DEFAULT_SETTINGS);
			setAgentInfo(agent);

			const newForm = assign(deepCopy(DEFAULT_SETTINGS), agent);
			newForm.settings = assign(
				deepCopy(DEFAULT_SETTINGS.settings),
				newForm.settings || {},
			);
			setForm(newForm);

			setOriginalModelConfig({
				fast_reasoning: { ...newForm.settings.fast_reasoning_config },
				skill_run: { ...newForm.settings.skill_run_config },
			});

			if (
				agent.settings?.tool_model_value &&
				!newForm.settings.tool_model_config?.model_name
			) {
				const [channel_id, model_name, channel_type] = String(
					agent.settings.tool_model_value,
				).split("_53aikm_");
				newForm.settings.tool_model_config = {
					channel_id: Number(channel_id) || 0,
					model_name: model_name || "",
					channel_type: Number(channel_type) || 0,
				};
				setForm(newForm);
			}

			// 初始化技能库列表（已选择的技能）
			if (newForm.settings.skills && newForm.settings.skills.length > 0) {
				setSkillLibraryList(
					newForm.settings.skills.map((skill: any) => ({
						...skill,
						id: skill.skill_id,
						value: skill.skill_id,
						label: skill.display_name || skill.skill_name,
					})),
				);
			}

			if (agent.agent_id) {
				loadModels(agent);
			}

			onAgentChange?.(agent);
		} finally {
			setIsLoading(false);
			onLoading?.(false);
		}
	};

	useEffect(() => {
		loadList();
	}, []);

	// 渲染开场白
	const renderOpeningStatement = () => (
		<div className="w-full flex gap-3 mb-4">
			<div className="size-9 flex-none">
				<img
					src={getPublicPath("/images/work-ai-avatar.png")}
					alt="Assistant"
				/>
			</div>
			<div className="py-1 px-[10px] bg-[#F5F6FA] rounded-[10px] break-all whitespace-pre-wrap">
				{form.settings.opening_statement}
			</div>
		</div>
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<Spin />
			</div>
		);
	}

	return (
		<div className="flex flex-col bg-white px-2 pt-4 h-full overflow-hidden">
			<div className="flex-1 flex gap-4 overflow-y-auto">
				<div className="flex-1 min-w-0 h-full overflow-auto flex flex-col gap-4">
					{/* 认知大脑 */}
					<div className="bg-white rounded-lg border border-[#EDEDED] p-4">
						<div className="flex items-start gap-3">
							<div className="size-10 rounded-lg bg-[#E9EFFF] flex items-center justify-center text-brand">
								<SvgIcon name="combine" size="20" />
							</div>
							<div className="flex-1">
								<div className="text-[15px] text-primary font-semibold">
									{t("work_ai.cognitive_brain")}
								</div>
								<div className="text-sm text-disabled">
									{t("work_ai.cognitive_brain_desc")}
								</div>
							</div>
						</div>

						{/* 工作流可视化 */}
						<div className="mt-4 border border-[#EDEDED] rounded-lg bg-[#FBFCFF] h-[190px] p-5 flex items-center gap-1">
							<div className="w-[107px] h-full rounded-lg border border-t-[#EDEDED] border-t-[4px] bg-white flex items-center justify-center flex-col gap-4">
								<div className="size-12 rounded-full border border-[#EDEDED] flex items-center justify-center text-disabled">
									<SvgIcon name="people-right" size="24" />
								</div>
								<div className="text-sm text-secondary">
									{t("work_ai.user_input")}
								</div>
							</div>
							<RightOutlined style={{ fontSize: 24, color: "#D3D9E6" }} />
							<div className="flex-1 h-full border border-t-[#2F6BFF] border-t-[4px] bg-white rounded-lg px-4 py-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-1">
										<SvgIcon name="optimise" size="16" />
										<div className="text-sm text-brand font-semibold">
											{t("work_ai.planning_reasoning")}
										</div>
									</div>
									<div className="text-sm text-disabled px-2 py-1 rounded bg-[#F2F6FF]">
										<ModelView
											channelId={form.settings.fast_reasoning_config.channel_id}
											model={form.settings.fast_reasoning_config.model_name}
											type="model"
											showIcon={false}
											placeholder="--"
											size={14}
										/>
									</div>
								</div>
								<div className="mt-3 grid grid-cols-3 gap-2 text-sm">
									<div className="py-4 rounded bg-[#F8F9FA] flex items-center justify-center flex-col gap-2 text-secondary">
										<SvgIcon name="round" size="16" />
										{t("work_ai.planning")}
									</div>
									<div className="py-4 rounded bg-[#F8F9FA] flex items-center justify-center flex-col gap-2 text-secondary">
										<SvgIcon name="brain" size="16" />
										{t("work_ai.reasoning")}
									</div>
									<div className="py-4 rounded bg-[#F8F9FA] flex items-center justify-center flex-col gap-2 text-secondary">
										<SvgIcon name="refresh_v2" size="16" />
										{t("work_ai.reflection")}
									</div>
								</div>
							</div>
							<RightOutlined style={{ fontSize: 24, color: "#D3D9E6" }} />
							<div className="h-full flex items-center justify-center flex-col gap-2 text-sm">
								<div className="w-[100px] h-8 rounded-lg bg-[#F5F8FF] border border-[#DDE7FF] text-brand flex items-center justify-center gap-1.5">
									<SvgIcon className="flex-none" name="brower" size="16" />
									Browser
								</div>
								<div className="w-[100px] h-8 rounded-lg bg-[#F5F8FF] border border-[#FFE4C2] text-[#F59E0B] flex items-center justify-center gap-1.5">
									<SvgIcon
										className="flex-none"
										name="terminal"
										size="16"
										color="#F59E0B"
									/>
									Sandbox
								</div>
							</div>
						</div>

						{/* 模型选择 */}
						<div className="mt-4 grid grid-cols-2 gap-4">
							<div className="">
								<div className="text-sm text-secondary mb-2">
									{t("work_ai.planning_reasoning_model")}
								</div>
								<ModelSelectPopover
									customClass="w-full"
									value={fastReasoningValue}
									channelId={form.settings.fast_reasoning_config.channel_id}
									modelName={form.settings.fast_reasoning_config.model_name}
									temperature={form.settings.fast_reasoning_config.temperature}
									type={MODEL_USE_TYPE.REASONING}
									onChange={setFastReasoningValue}
									onTemperatureChange={(value) => {
										setForm((prev: any) => ({
											...prev,
											settings: {
												...prev.settings,
												fast_reasoning_config: {
													...prev.settings.fast_reasoning_config,
													temperature: value,
												},
											},
										}));
									}}
								/>
								<div className="text-xs text-disabled mt-2">
									{t("work_ai.planning_reasoning_model_desc")}
								</div>
							</div>
							<div className="">
								<div className="text-sm text-secondary mb-2">
									{t("work_ai.skill_execution_model")}
								</div>
								<ModelSelectPopover
									customClass="w-full"
									value={skillRunValue}
									channelId={form.settings.skill_run_config.channel_id}
									modelName={form.settings.skill_run_config.model_name}
									temperature={form.settings.skill_run_config.temperature}
									type={MODEL_USE_TYPE.REASONING}
									onChange={setSkillRunValue}
									onTemperatureChange={(value) => {
										setForm((prev: any) => ({
											...prev,
											settings: {
												...prev.settings,
												skill_run_config: {
													...prev.settings.skill_run_config,
													temperature: value,
												},
											},
										}));
									}}
								/>
								<div className="text-xs text-disabled mt-2">
									{t("work_ai.skill_execution_model_desc")}
								</div>
							</div>
						</div>
					</div>

					{/* 元指令 */}
					<div className="bg-white rounded-lg border border-[#EDEDED] p-4">
						<div className="flex items-start gap-3">
							<div className="size-10 rounded-lg bg-[#FEE2E2] flex items-center justify-center text-brand">
								<SvgIcon name="prompt_v3" size="20" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="text-[15px] text-primary font-semibold">
									{t("work_ai.meta_instruction")}
								</div>
								<div className="text-sm text-disabled">
									{t("work_ai.meta_instruction_desc")}
								</div>
							</div>
						</div>
						<div className="mt-3">
							<Input.TextArea
								value={form.prompt}
								onChange={(e) =>
									setForm((prev: any) => ({ ...prev, prompt: e.target.value }))
								}
								rows={3}
								style={{ backgroundColor: "#F7F8FA", resize: "none" }}
								placeholder={t("work_ai.meta_instruction_placeholder")}
							/>
						</div>
					</div>

					{/* 主动欢迎语 */}
					<div className="bg-white rounded-lg border border-[#EDEDED] p-4">
						<div className="flex items-start gap-3">
							<div className="size-10 rounded-lg bg-[#E0EAFF] flex items-center justify-center text-brand">
								<SvgIcon name="info_v2" size="20" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="text-[15px] text-primary font-semibold">
									{t("work_ai.active_welcome")}
								</div>
								<div className="text-sm text-disabled">
									{t("work_ai.opening_statement")}
								</div>
							</div>
						</div>
						<div className="mt-3">
							<Input
								value={form.settings.opening_statement}
								onChange={(e) =>
									setForm((prev: any) => ({
										...prev,
										settings: {
											...prev.settings,
											opening_statement: e.target.value,
										},
									}))
								}
								className="w-full"
								maxLength={200}
								showCount
							/>
						</div>
					</div>

					{/* 技能配置 */}
					<div className="bg-white rounded-lg border border-[#EDEDED] p-4">
						<div className="flex items-start gap-3">
							<div className="size-10 rounded-lg bg-[#FFF0F0] flex items-center justify-center text-tag-red">
								<SvgIcon name="terminal" size="20" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="text-[15px] text-primary font-semibold">
									{t("work_ai.skill_config")}
								</div>
								<div className="text-sm text-disabled">
									配置"技能管理" 菜单中的预设的技能
								</div>
							</div>
						</div>
						<div className="mt-3 flex flex-col gap-2">
							{selectedSkills?.map((item: any) => (
								<div
									key={item.skill_id}
									className="h-15 border border-[#EFEFEF] rounded-lg px-3 flex items-center justify-between bg-[#F8F9FA]"
								>
									<div className="w-full flex items-center justify-between group">
										<div className="flex items-center gap-2">
											<div className="size-8 bg-[#F0F2F5] rounded flex items-center justify-center shrink-0">
												<SvgIcon name="lightning" size="18" color="#2563EB" />
											</div>
											<div className="text-sm text-primary truncate">
												{item.display_name || item.skill_name}
											</div>
										</div>
										<Button
											className="invisible group-hover:visible hover:!text-tag-red"
											icon={<DeleteOutlined />}
											type="link"
											onClick={() => handleSkillRemove(item)}
										/>
									</div>
								</div>
							))}
						</div>
						<div className="mt-3">
							<ResourcePicker
								value={skillLibraryList}
								groupType={GROUP_TYPE.SKILLS}
								title={t("action_add")}
								onConfirm={handleSkillConfirm}
							>
								<Button
									color="primary"
									variant="filled"
									disabled={selectedSkills?.length >= 6}
								>
									+ 添加
								</Button>
							</ResourcePicker>
						</div>
					</div>
				</div>

				{/* 预览面板 */}
				<div className="flex-none w-1/3 min-w-[430px] h-full overflow-hidden">
					<div className="bg-white rounded-lg border border-[#EDEDED] py-4 h-full flex flex-col">
						<ChatConfigProvider buildLibraryUrl={buildFrontLibraryFileUrl}>
							<div className="flex items-center justify-between mb-4 px-4">
								<div className="text-sm text-primary font-semibold">
									效果预览
								</div>
							</div>

							{/* 聊天预览区域 */}
							<div className="flex-1 flex flex-col relative overflow-hidden">
								<div className="flex-1 overflow-hidden">
									<XBubbleList
										ref={(bubbleListRef) => {}}
										autoScroll={true}
										className="relative"
										mainClass="px-4"
										messages={messageList}
										enablePullUp
										header={renderOpeningStatement()}
										renderItem={(message, index) => (
											<React.Fragment key={message.id || index}>
												{/* 用户消息气泡 */}
												<div className="flex items-center gap-5 rounded-xl">
													<div className="flex-1 overflow-hidden">
														<XBubbleUser
															content={
																message.original_question || message.question
															}
															files={message.user_files}
															avatar={
																userStore.info?.avatar ||
																getPublicPath("/images/default_avatar.png")
															}
															header={
																<SpecifiedFiles
																	files={[
																		...message.specified_files,
																		...(message.uploaded_files || []),
																	]}
																	onFileClick={handleFileClick}
																/>
															}
															contentBefore={
																message.skill?.display_name ? (
																	<span className="bg-[#e6e9f2] rounded py-1 px-2 text-sm mr-2">
																		{message.skill.display_name ?? ""}
																	</span>
																) : null
															}
														/>
													</div>
												</div>

												{/* AI助手消息气泡 */}
												<div className="flex items-center gap-5 rounded-xl">
													<div className="flex-1 overflow-hidden">
														<XBubbleAssistant
															content={message.answer}
															avatar={getPublicPath(
																"/images/work-ai-avatar.png",
															)}
															reasoning={message.reasoning_content}
															reasoningExpanded={message.reasoning_expanded}
															streaming={message.loading}
															alwaysShowMenu={
																index === messageList.length - 1 ||
																message.feedbackVisible
															}
															renderSource={(type: string, number: number) =>
																renderSource(type, number, message)
															}
															showError={message.error}
															sourceEnabled
															onSourceReferenceHover={(data: any) =>
																handleSourceReferenceHover(data, message)
															}
														>
															{canUseKnowledgeBase && (
																<RagHeader
																	ragStats={message.rag_stats}
																	loading={message.loading}
																	ragSearchText={message.rag_search_text}
																	showLibraryCount={true}
																	onOpenKnow={() => handleOpenKnow(message)}
																/>
															)}
															{/* 输出文件展示 */}
															{message.outputFiles?.length > 0 && (
																<div className="flex flex-wrap gap-3 mt-3">
																	{message.outputFiles.map((file: any) => (
																		<div
																			key={file.id}
																			className="w-[280px] flex items-center justify-between px-4 py-4 bg-[#f5f7fa] border border-[#E8E8E8] rounded-lg cursor-pointer hover:shadow-sm hover:border-[#D9D9D9] transition-all group"
																			onClick={() => {
																				if (file.url) {
																					const token =
																						localStorage.getItem(
																							"access_token",
																						) || "";
																					fetch(file.url, {
																						headers: {
																							Authorization: `Bearer ${token}`,
																						},
																					})
																						.then((res) => res.blob())
																						.then((blob) => {
																							const blobUrl =
																								URL.createObjectURL(blob);
																							const a =
																								document.createElement("a");
																							a.href = blobUrl;
																							a.download =
																								file.file_name ||
																								`文件 ${file.id}`;
																							document.body.appendChild(a);
																							a.click();
																							document.body.removeChild(a);
																							setTimeout(
																								() =>
																									URL.revokeObjectURL(blobUrl),
																								100,
																							);
																						});
																				}
																			}}
																		>
																			<div className="flex flex-col gap-1 flex-1 min-w-0">
																				<SvgIcon
																					name="file"
																					size="16"
																					className="text-tertiary"
																				/>
																				<span className="text-sm text-[#555454] truncate">
																					{file.file_name || `文件 ${file.id}`}
																				</span>
																			</div>
																			<div className="w-20 relative">
																				<img
																					src={getPublicPath(
																						"/images/output-file.png",
																					)}
																					alt=""
																				/>
																			</div>
																		</div>
																	))}
																</div>
															)}
															{!message.loading &&
																agentInfo?.settings?.answer_remarks_config
																	?.enable && (
																	<div className="text-sm text-placeholder break-words my-2">
																		{
																			agentInfo.settings.answer_remarks_config
																				.content
																		}
																	</div>
																)}
															{message.rag_stats?.file_quotations?.length >
																0 && (
																<Quotation
																	type={message.rag_stats.type}
																	files={message.rag_stats.file_quotations}
																/>
															)}
															{message.error && (
																<div className="text-[#262626]">
																	{t("agent.error_tip")}
																	<span
																		className="text-blue-500 cursor-pointer underline"
																		onClick={() =>
																			handleShowErrorDetails(message)
																		}
																	>
																		{t("agent.error_details")}
																	</span>
																	{(message as any).showErrorDetails && (
																		<div className="mt-2 whitespace-pre-wrap">
																			{message.answer}
																		</div>
																	)}
																</div>
															)}
														</XBubbleAssistant>
													</div>
												</div>
											</React.Fragment>
										)}
									/>
								</div>
								<div className="flex-none w-full px-4">
									<Sender
										className="w-full"
										showAt={is_internal && canUseKnowledgeBase}
										showSkill={false}
										disabledAt={state.networkSearch}
										atToolTip="指定知识问答"
										placeholder="分配一项任务或基于企业知识提任何问题"
										loading={state.isStreaming}
										library={undefined}
										enhancedMention={true}
										selectedSkills={state.selectedSkills}
										enableUpload={true}
										allowMultiple={true}
										allowSendWithFiles={true}
										acceptTypes=".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.zip,.rar"
										httpRequest={async (file: File) => {
											const uploadApi = await import("@/api/modules/upload");
											const res = await uploadApi.default.upload(file);
											return {
												id: res.data?.id,
												name: file.name,
												size: file.size,
												mime_type: file.type,
												preview_key: res.data?.preview_key,
												url: res.data?.preview_key
													? `${(window as any).$api_host || ""}/api/preview/${res.data.preview_key}`
													: "",
											};
										}}
										onSend={handleSend}
										onStop={handleStop}
										onSelectSkill={handleSelectSkillFromMention}
										onRemoveSkill={() =>
											setState((prev) => ({ ...prev, selectedSkills: [] }))
										}
									/>
								</div>
								<Chunk
									ref={chunkRef}
									virtualRef={chunkSourceRef}
									fetchChunkDetail={fetchChunkDetail}
								/>
							</div>
							{state.showThinkKnowledge && (
								<ThinkKnowledge
									className="w-[418px] h-[calc(100%-80px)] mt-4 border-l"
									slots={{ KnowledgeViewDrawer }}
									onClose={() =>
										setState((prev) => ({ ...prev, showThinkKnowledge: false }))
									}
									ref={thinkKnowledgeRef}
								/>
							)}
						</ChatConfigProvider>
					</div>
				</div>
			</div>

			<Divider />
			<div>
				<Button type="primary" onClick={handleSave}>
					发布更新
				</Button>
			</div>
		</div>
	);
};

export default WorkAISetting;
