import { Search } from "@km/shared-components-react";
import { SettingOutlined } from "@ant-design/icons";
import { Button, Input, Modal, message, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { spacesApi } from "@/api/modules/spaces";
import { transformSpaceList } from "@/api/modules/spaces/transform";
import type { SpaceDisplayItem } from "@/api/modules/spaces/types";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useListState, useVersion } from "@/hooks";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import Detail, { type DetailRef } from "./components/Detail";
import InfoSaveDialog, {
	type InfoSaveDialogRef,
} from "./components/InfoSaveDialog";

/**
 * URL 持久化状态（page/pageSize 在请求时换算为 offset/limit）
 */
interface SpaceUrlState {
	page: number;
	pageSize: number;
	name: string;
}

export function SpacePage() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [tableData, setTableData] = useState<SpaceDisplayItem[]>([]);
	const [total, setTotal] = useState(0);
	const detailRef = useRef<DetailRef>(null);
	const infoSaveDialogRef = useRef<InfoSaveDialogRef>(null);
	const createBtnRef = useRef<HTMLButtonElement>(null);

	// 筛选 / 分页状态（URL 持久化）
	const defaultUrlState = useMemo<SpaceUrlState>(
		() => ({
			page: 1,
			pageSize: 10,
			name: "",
		}),
		[],
	);
	const { state, stateRef, updateState } = useListState<SpaceUrlState>(
		defaultUrlState,
		{ enableUrlSync: true, urlPrefix: "space_" },
	);

	const { guard: guardSpaceVersion } = useVersion({
		module: VERSION_MODULE.SPACE_COUNT,
		count: total,
		content: t("version.knowledge_limit"),
	});

	// Load data
	const loadData = useCallback(async () => {
		const current = stateRef.current;
		setLoading(true);
		try {
			const res = await spacesApi.list({
				name: current.name,
				offset: (current.page - 1) * current.pageSize,
				limit: current.pageSize,
				view: "admin",
			});
			setTableData(transformSpaceList(res?.spaces || []));
			setTotal(res?.count || 0);
		} catch (error) {
			console.error("Load space list error:", error);
		} finally {
			setLoading(false);
		}
	}, [stateRef]);

	const refresh = useCallback(
		(reset: boolean = true) => {
			if (reset) {
				updateState({ page: 1 });
			}
			loadData();
		},
		[updateState, loadData],
	);

	// Handle add
	const handleAdd = useCallback(() => {
		if (guardSpaceVersion()) {
			infoSaveDialogRef.current?.open();
		}
	}, [guardSpaceVersion]);

	// Handle view
	const handleView = useCallback((item: SpaceDisplayItem) => {
		navigate(
			`/space/${item.id}/setting/basic-info`,
		);
	}, []);

	// Handle delete
	const handleDelete = useCallback(
		(item: SpaceDisplayItem) => {
			Modal.confirm({
				title: t("space.delete_confirm"),
				content: (
					<div>
						<p className="text-tag-red">{t("space.delete_confirm_warning")}</p>
						<p>{t("space.delete_confirm_input_hint", { name: item.name })}</p>
						<Input
							placeholder={t("space.delete_confirm_tip_placeholder")}
							id="delete-confirm-input"
						/>
					</div>
				),
				okText: t("action_delete"),
				okButtonProps: { danger: true },
				cancelText: t("action_cancel"),
				centered: true,
				onOk: async () => {
					const input = document.getElementById(
						"delete-confirm-input",
					) as HTMLInputElement;
					const value = input?.value || "";
					if (value !== item.name) {
						message.error(t("space.delete_confirm_tip_placeholder"));
						return Promise.reject();
					}
					try {
						await spacesApi.delete(item.id);
						message.success(t("action_delete_success"));
						refresh(false);
					} catch (error) {
						console.error("Delete space error:", error);
						return Promise.reject();
					}
				},
			});
		},
		[refresh],
	);

	// Table columns
	const columns: ColumnsType<SpaceDisplayItem> = useMemo(
		() => [
			{
				title: t("common.name"),
				dataIndex: "name",
				key: "name",
				minWidth: 160,
				maxWidth: 200,
				ellipsis: true,
				render: (_, record) => (
					<div className="flex items-center gap-2">
						<img
							src={record.icon}
							className="size-7 rounded-full"
							alt={record.name}
							onError={(e) => {
								const target = e.target as HTMLImageElement;
								target.src = getPublicPath("/images/default_agent.png");
							}}
						/>
						<span>{record.name}</span>
					</div>
				),
			},
			{
				title: t("common.creator"),
				dataIndex: "owner_info",
				key: "owner_info",
				minWidth: 160,
				maxWidth: 200,
				ellipsis: true,
				render: (_, record) => {
					if (record.is_default) {
						return (
							<div className="flex items-center gap-2">
								<div className="size-7 bg-[#E0EEFF] flex items-center justify-center rounded-full">
									<div className="text-xs text-brand">{t("common.system_avatar")}</div>
								</div>
								{t("space.system")}
							</div>
						);
					}
					return (
						<div className="flex items-center gap-2">
							<img
								src={(record.owner_info as any)?.avatar}
								className="size-7 rounded-full"
								alt=""
								onError={(e) => {
									const target = e.target as HTMLImageElement;
									target.src = getPublicPath("/images/default_avatar.png");
								}}
							/>
							{(record.owner_info as any)?.nickname || "--"}
						</div>
					);
				},
			},
			{
				title: t("created_time"),
				dataIndex: "created_time",
				key: "created_time",
				minWidth: 160,
				render: (time: string) => time || "--",
			},
			{
				title: t("knowledge.name"),
				dataIndex: "library_count",
				key: "library_count",
				minWidth: 120,
			},
			{
				title: t("operation"),
				key: "operation",
				width: 170,
				align: "right",
				render: (_, record) => {
					const isSystemSpace = record.is_default;
					const hasLibraries = record.library_count > 0;

					return (
						<div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
							<Tooltip title={t("space.setting.title")}>
								<Button
									type="link"
									icon={<SettingOutlined />}
									onClick={(e) => {
										e.stopPropagation();
										handleView(record);
									}}
								/>
							</Tooltip>
						</div>
					);
				},
			},
		],
		[t, handleView, handleDelete, navigate],
	);

	// 监听 URL 状态变化，重新加载数据
	const stateKey = JSON.stringify(state);
	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stateKey]);

	return (
		<div className="h-full flex flex-col bg-white px-2 py-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Search
						mode="expanded"
						value={state.name}
						onDebouncedChange={(val) => updateState({ name: val })}
						className="max-w-[268px]"
						placeholder={t("space.search_placeholder")}
					/>
				</div>
			</div>

			{/* Table */}
			<div className="flex-1 overflow-y-auto bg-white rounded-lg mt-4">
				<Table
					rowKey="id"
					columns={columns}
					dataSource={tableData}
					loading={loading}
					pagination={{
						current: state.page,
						pageSize: state.pageSize,
						total,
						showSizeChanger: true,
						showTotal: (total) => t("table_footer_text", { total }),
						onChange: (page, pageSize) => {
							if (pageSize !== state.pageSize) {
								updateState({ page: 1, pageSize });
							} else {
								updateState({ page });
							}
						},
					}}
					scroll={{ x: "max-content" }}
					onRow={(record) => ({
						className: "group cursor-pointer",
						onClick: () => handleView(record),
					})}
				/>
			</div>

			{/* Detail Drawer */}
			<Detail ref={detailRef} onRefresh={refresh} />

			{/* Create/Edit Dialog */}
			<InfoSaveDialog ref={infoSaveDialogRef} onRefresh={refresh} />
		</div>
	);
}

export default SpacePage;
