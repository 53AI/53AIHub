import { Search, SvgIcon, SafeImage, IconAction } from "@km/shared-components-react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { spacesApi } from "@/api/modules/spaces";
import { transformSpaceList } from "@/api/modules/spaces/transform";
import type { SpaceDisplayItem } from "@/api/modules/spaces/types";
import { useListState } from "@/hooks";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import SpaceSettingDrawer, {
	type SpaceSettingDrawerRef,
} from "./components/SpaceSettingDrawer";

/**
 * URL 持久化状态（page/pageSize 在请求时换算为 offset/limit）
 */
interface SpaceUrlState {
	page: number;
	pageSize: number;
	name: string;
}

export function SpacePage() {
	const [loading, setLoading] = useState(false);
	const [tableData, setTableData] = useState<SpaceDisplayItem[]>([]);
	const [total, setTotal] = useState(0);
	const settingDrawerRef = useRef<SpaceSettingDrawerRef>(null);
	const deepLinkOpenedRef = useRef(false);
	const [searchParams, setSearchParams] = useSearchParams();

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

	// Handle view
	const handleView = useCallback((item: SpaceDisplayItem) => {
		settingDrawerRef.current?.open(item);
	}, []);

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
						<SafeImage
							src={record.icon}
							className="size-7 rounded-full"
							alt={record.name}
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
				width: 100,
				align: "right",
				render: (_, record) => (
					<div className="flex items-center justify-end gap-1">
						<IconAction
							variant="row"
							title={t("space.setting.title")}
							onClick={() => handleView(record)}
						>
							<SvgIcon name="setting" />
						</IconAction>
					</div>
				),
			},
		],
		[t, handleView],
	);

	// 监听 URL 状态变化，重新加载数据
	const stateKey = JSON.stringify(state);
	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stateKey]);

	// 深度链接：?spaceId=xxx&tab=xxx 加载完成后自动打开 Drawer 并切到对应 tab
	useEffect(() => {
		if (deepLinkOpenedRef.current) return;
		const spaceId = searchParams.get("spaceId");
		if (!spaceId || tableData.length === 0) return;
		const target = tableData.find((s) => s.id === spaceId);
		if (!target) return;
		deepLinkOpenedRef.current = true;
		settingDrawerRef.current?.open(target, searchParams.get("tab") || undefined);
		const next = new URLSearchParams(searchParams);
		next.delete("spaceId");
		next.delete("tab");
		setSearchParams(next, { replace: true });
	}, [searchParams, tableData, setSearchParams]);

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

			{/* Setting Drawer */}
			<SpaceSettingDrawer ref={settingDrawerRef} />
		</div>
	);
}

export default SpacePage;
