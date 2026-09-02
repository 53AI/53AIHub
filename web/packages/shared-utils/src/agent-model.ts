// 智能体模型下拉项构建:约定模型列表第 2 个(index === 1)必为深度思考模型。

export type AgentModel = {
	id: number;
	channel_id: number;
	channel_type: number;
	model: string;
	model_name?: string;
};

export type AgentModelOption = AgentModel & {
	type: "deep_reasoning" | "fast_reasoning";
	icon: "star-link" | "lightning";
	name: string;
	temperature: number;
	value: string;
};

type BuildAgentModelOptionsParams = {
	models?: AgentModel[];
	/** 深度思考温度配置,缺省 0.5 */
	deepConfig?: { temperature?: number };
	/** 快速推理温度配置,缺省 0.5 */
	fastConfig?: { temperature?: number };
	deepName: string;
	fastName: string;
};

/** 按「第 2 个(index===1)必为深度思考」约定生成模型下拉项,并按 type 去重 */
export function buildAgentModelOptions({
	models,
	deepConfig,
	fastConfig,
	deepName,
	fastName,
}: BuildAgentModelOptionsParams): AgentModelOption[] {
	const deepTemperature = deepConfig?.temperature ?? 0.5;
	const fastTemperature = fastConfig?.temperature ?? 0.5;

	return (models ?? [])
		.map((item, index) => {
			const isDeep = index === 1;
			const typeKey = isDeep ? "deep" : "fast";
			const value = `${typeKey}_${item.channel_id}_${item.channel_type}_${item.model}`;
			return {
				...item,
				type: isDeep ? ("deep_reasoning" as const) : ("fast_reasoning" as const),
				icon: isDeep ? ("star-link" as const) : ("lightning" as const),
				name: isDeep ? deepName : fastName,
				temperature: isDeep ? deepTemperature : fastTemperature,
				value,
			};
		})
		.filter(
			(item, index, self) =>
				index === self.findIndex((t) => t.type === item.type),
		);
}