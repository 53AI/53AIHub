import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Input, Modal, Spin, Tag, message } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { ApiGuide } from "@km/shared-business/api-guide";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { spaceApiKeysApi, type ScopedApiKey } from "@/api/modules/api-key";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { api_host } from "@/utils/config";
import { t } from "@/locales";

const maskKey = (key: string) => `${key.slice(0, 4)}...${key.slice(-4)}`;

export type ApiTabProps = {
	space: SpaceItem;
};

export function ApiTab({ space }: ApiTabProps) {
	const [apiKeys, setApiKeys] = useState<ScopedApiKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [keyName, setKeyName] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	const endpoints = [
		{
			label: t("space.api.externalKnowledge"),
			value: `${api_host}/api/external-knowledge`,
		},
		{
			label: t("space.api.externalWiki"),
			value: `${api_host}/api/external-wiki`,
		},
	];

	const guideContent = t("space.api.guideContent", {
		wikiEndpoint: `${api_host}/api/external-wiki`,
		knowledgeEndpoint: `${api_host}/api/external-knowledge`,
	});

	const loadKeys = useCallback(async () => {
		setLoading(true);
		try {
			setApiKeys(await spaceApiKeysApi.list(space.id));
		} catch {
			message.error(t("space.api.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [space.id]);

	useEffect(() => {
		loadKeys();
	}, [loadKeys]);

	const openCreate = () => {
		setKeyName("");
		setCreateOpen(true);
	};

	const handleCreate = async () => {
		const name = keyName.trim();
		if (!name) {
			message.warning(t("space.api.nameRequired"));
			return;
		}
		setCreating(true);
		try {
			await spaceApiKeysApi.create(space.id, {
				name,
				description: t("space.api.keyDescription"),
			});
			message.success(t("space.api.created"));
			setCreateOpen(false);
			await loadKeys();
		} catch {
			message.error(t("space.api.createFailed"));
		} finally {
			setCreating(false);
		}
	};

	const handleDelete = (apiKey: ScopedApiKey) => {
		Modal.confirm({
			title: t("space.api.deleteTitle"),
			content: t("space.api.deleteConfirm"),
			okText: t("action.confirm"),
			cancelText: t("action.cancel"),
			okButtonProps: { danger: true },
			onOk: async () => {
				await spaceApiKeysApi.delete(space.id, apiKey.id);
				message.success(t("space.api.deleted"));
				await loadKeys();
			},
		});
	};

	const handleCopy = async (value: string) => {
		const success = await copyToClip(value, containerRef.current || undefined);
		if (success) {
			message.success(t("space.api.copied"));
		} else {
			message.error(t("space.api.copyFailed"));
		}
	};

	return (
		<div ref={containerRef} className="h-full overflow-y-auto py-2">
			<div className="pb-10 flex flex-col gap-8">
				<section>
					<h2 className="text-base font-medium text-[#1D1E1F] m-0 mb-3">
						{t("space.api.endpointTitle")}
					</h2>
					<p className="text-sm text-[#4F5052] m-0 mb-4">
						{t("space.api.description")}
					</p>
					<div className="flex flex-col gap-3">
						{endpoints.map((endpoint) => (
							<div
								key={endpoint.value}
								className="h-10 px-4 flex items-center border rounded-xl bg-[#F6F6F9]"
							>
								<Tag className="!m-0 mr-2" bordered={false}>
									{endpoint.label}
								</Tag>
								<p className="flex-1 text-sm text-[#6E7278] truncate m-0">
									{endpoint.value}
								</p>
								<div className="flex-none border-l pl-4 pr-1 flex items-center">
									<SvgIcon
										name="copy"
										className="size-4 cursor-pointer text-placeholder"
										onClick={() => handleCopy(endpoint.value)}
									/>
								</div>
							</div>
						))}
					</div>
				</section>
				<section>
					<div className="flex items-center justify-between mb-3">
						<h2 className="text-base font-medium text-[#1D1E1F] m-0">
							{t("space.api.keysTitle")}
						</h2>
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={openCreate}
						>
							{t("space.api.create")}
						</Button>
					</div>

					{loading ? (
						<div className="flex items-center justify-center py-16">
							<Spin />
						</div>
					) : apiKeys.length === 0 ? (
						<Empty
							className="py-10"
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={t("space.api.empty")}
						>
						</Empty>
					) : (
						apiKeys.map((apiKey) => (
							<div
								key={apiKey.id}
								className="h-12 mb-[10px] px-4 flex items-center border rounded-xl bg-[#F6F6F9]"
							>
								<div className="min-w-0 flex-1 flex items-center gap-2">
									<span className="text-sm font-medium text-[#1D1E1F] truncate">
										{apiKey.name}
									</span>
									<code className="text-xs text-[#8A8E95] truncate">
										{maskKey(apiKey.key)}
									</code>
								</div>
								<div className="flex-none border-l pl-4 pr-1 flex items-center gap-4">
									<SvgIcon
										name="copy"
										className="size-4 cursor-pointer text-placeholder"
										onClick={() => handleCopy(apiKey.key)}
									/>
									<DeleteOutlined
										className="size-4 cursor-pointer text-placeholder hover:text-red-500"
										onClick={() => handleDelete(apiKey)}
									/>
								</div>
							</div>
						))
					)}
				</section>

				{/* 接入指引（与前台共用 @km/shared-business/api-guide） */}
				<section>
					<h2 className="text-base font-medium text-[#1D1E1F] m-0 mb-3">
						{t("space.api.guide")}
					</h2>
					<ApiGuide
						labels={{
							studio: t("space.api.guideStudio"),
							dify: t("space.api.guideDify"),
							wiki: t("space.api.guideWiki"),
						}}
						wikiTitle={t("space.api.guideTitle")}
						wikiContent={guideContent}
						zIndex={1001}
					/>
				</section>
			</div>

			<Modal
				title={t("space.api.create")}
				open={createOpen}
				onOk={handleCreate}
				onCancel={() => setCreateOpen(false)}
				okText={t("space.api.create")}
				cancelText={t("action.cancel")}
				confirmLoading={creating}
			>
				<Input
					value={keyName}
					onChange={(e) => setKeyName(e.target.value)}
					placeholder={t("space.api.namePlaceholder")}
					maxLength={50}
					onPressEnter={handleCreate}
				/>
			</Modal>
		</div>
	);
}

export default ApiTab;
