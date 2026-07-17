import { UserOutlined } from "@ant-design/icons";
import { Search, SvgIcon } from "@km/shared-components-react";
import { Button, Modal, message, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { userApi } from "@/api/modules/user";
import { PageLayoutContent } from "@/components/PageLayout";
import { useListState } from "@/hooks";
import { t } from "@/locales";
import { useUserStore } from "@/stores";
import UserStatus from "../components/UserInternalStatus";
import UserSelectDialog from "../components/UserSelectDialog";

// Types
interface AdminUser {
	user_id: number;
	nickname: string;
	mobile: string;
	email: string;
	role: number;
	role_label: string;
	is_admin: boolean;
	status: number;
	add_admin_time: string;
}

/**
 * URL 持久化状态
 */
interface AdminUrlState {
	page: number;
	pageSize: number;
	keyword: string;
}

export function UserAdminPage() {
	const userStore = useUserStore();

	// 列表数据状态（本地，非 URL 持久化）
	const [loading, setLoading] = useState(false);
	const [tableData, setTableData] = useState<AdminUser[]>([]);
	const [tableTotal, setTableTotal] = useState(0);

	// 筛选 / 分页状态（URL 持久化）
	const defaultUrlState = useMemo<AdminUrlState>(
		() => ({
			page: 1,
			pageSize: 10,
			keyword: "",
		}),
		[],
	);
	const { state, stateRef, updateState } = useListState<AdminUrlState>(
		defaultUrlState,
		{ enableUrlSync: true, urlPrefix: "admin_" },
	);

	// Dialog state
	const [userSelectDialogOpen, setUserSelectDialogOpen] = useState(false);

	// User info
	const userInfo = useMemo(() => userStore.info, [userStore.info]);

	// Fetch admin list
	const fetchAdminList = useCallback(async () => {
		const current = stateRef.current;
		setLoading(true);
		try {
			const { total = 0, list = [] } = await userApi.fetch_admin_user({
				keyword: current.keyword,
				offset: (current.page - 1) * current.pageSize,
				limit: current.pageSize,
			});
			setTableTotal(total);
			setTableData(list);
		} catch (error) {
			console.error("Fetch admin list error:", error);
		} finally {
			setLoading(false);
		}
	}, [stateRef]);

	// Handle add
	const handleAdd = () => {
		setUserSelectDialogOpen(true);
	};

	// Handle user select confirm
	const handleUserSelectConfirm = async ({ value }: { value: any[] }) => {
		try {
			await userApi.batch_save_admin({
				user_ids: value.map((item) => item.user_id),
			});
			message.success(t("action_add_success"));
			updateState({ page: 1 });
			fetchAdminList();
		} catch (error) {
			console.error("Add admin error:", error);
		}
	};

	// Handle delete
	const handleDelete = async (record: AdminUser) => {
		Modal.confirm({
			title: t("tip"),
			content: t("admin_user.delete_confirm"),
			onOk: async () => {
				try {
					await userApi.batch_remove_admin({ user_ids: [record.user_id] });
					message.success(t("action_delete_success"));
					fetchAdminList();
				} catch (error) {
					console.error("Delete admin error:", error);
				}
			},
		});
	};

	// Table columns
	const columns: ColumnsType<AdminUser> = useMemo(
		() => [
			{
				title: t("user"),
				dataIndex: "nickname",
				key: "nickname",
				width: 160,
				render: (value: string) => (
					<div className="flex items-center gap-1 w-full">
						<UserOutlined />
						<span className="truncate">{value}</span>
					</div>
				),
			},
			{
				title: t("mobile"),
				dataIndex: "mobile",
				key: "mobile",
				width: 140,
				render: (value: string) => (
					<span className={!value ? "text-gray-400" : ""}>{value || "--"}</span>
				),
			},
			{
				title: t("email"),
				dataIndex: "email",
				key: "email",
				width: 140,
				render: (value: string) => (
					<span className={!value ? "text-gray-400" : ""}>{value || "--"}</span>
				),
			},
			{
				title: t("role.title"),
				dataIndex: "role_label",
				key: "role_label",
				width: 120,
				render: (value: string) => (
					<span className={!value ? "text-gray-400" : ""}>
						{t(value) || "--"}
					</span>
				),
			},
			{
				title: t("internal_user.account.status"),
				dataIndex: "status",
				key: "status",
				width: 160,
				render: (value: number, record: AdminUser) => (
					<UserStatus
						value={value}
						userData={record}
						buttonDisabled={
							record.user_id === userInfo?.user_id || record.is_creator
						}
						onChange={() => fetchAdminList()}
					/>
				),
			},
			{
				title: t("add_time"),
				dataIndex: "add_admin_time",
				key: "add_admin_time",
				width: 160,
				render: (value: string) => (
					<span className={!value ? "text-gray-400" : ""}>
						{(value || "").slice(0, 16) || "--"}
					</span>
				),
			},
			{
				title: t("operation"),
				key: "operation",
				width: 60,
				fixed: "end",
				render: (_: any, record: AdminUser) => {
					if (record.is_admin && userInfo?.user_id !== record.user_id) {
						return (
							<Button
								type="link"
								danger
								icon={<SvgIcon name="delete" />}
								className="opacity-0 group-hover:opacity-100"
								onClick={(e) => {
									e.stopPropagation();
									handleDelete(record);
								}}
							/>
						);
					}
					return "--";
				},
			},
		],
		[t, userInfo?.user_id, fetchAdminList],
	);

	// 监听 URL 状态变化，重新加载数据
	const stateKey = JSON.stringify(state);
	useEffect(() => {
		fetchAdminList();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stateKey]);

	// Filter bar
	const filterBar = (
		<>
			<Search
				mode="expanded"
				value={state.keyword}
				onDebouncedChange={(val) => updateState({ keyword: val })}
				placeholder={t("admin_user.search_placeholder")}
				className="w-[268px]"
			/>
			<Button type="primary" onClick={handleAdd}>
				{t("action_add")}
			</Button>
		</>
	);

	return (
		<PageLayoutContent header={t("admin_user.title")} filterBar={filterBar}>
			<Table
				rowKey="user_id"
				columns={columns}
				dataSource={tableData}
				loading={loading}
				pagination={{
					current: state.page,
					pageSize: state.pageSize,
					total: tableTotal,
					showSizeChanger: true,
					showTotal: (total) => t("table_footer_text", { total }),
					onChange: (newPage, newPageSize) => {
						if (newPageSize !== state.pageSize) {
							updateState({ page: 1, pageSize: newPageSize });
						} else {
							updateState({ page: newPage });
						}
					},
				}}
				rowClassName="group"
			/>

			{/* User Select Dialog */}
			<UserSelectDialog
				open={userSelectDialogOpen}
				onClose={() => setUserSelectDialogOpen(false)}
				onSuccess={(result) => {
					setUserSelectDialogOpen(false);
					handleUserSelectConfirm(result);
				}}
			/>
		</PageLayoutContent>
	);
}

export default UserAdminPage;
