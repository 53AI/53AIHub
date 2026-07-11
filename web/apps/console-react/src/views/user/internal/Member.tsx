import { MoreOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import { Dropdown, Search, SvgIcon } from "@km/shared-components-react";
import { Button, Modal, message, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from "react";
import { departmentApi, userApi } from "@/api";
import {
	INTERNAL_USER_STATUS_ALL,
	INTERNAL_USER_STATUS_DISABLED,
	INTERNAL_USER_STATUS_ENABLED,
	INTERNAL_USER_STATUS_UNDEFINED,
} from "@/api/modules/user";
import { OpenData } from "@/components/OpenData";
import {
	ENTERPRISE_SYNC_FROM,
	type EnterpriseSyncFrom,
} from "@/constants/enterprise";
import { useListState } from "@/hooks";
import { t } from "@/locales";
import { useEnterpriseStore, useUserStore } from "@/stores";
import { getPublicPath } from "@/utils/config";
import UserAddDialog from "../components/UserInternalAddDialog";
import UserEditDrawer from "../components/UserInternalEditDrawer";
import UserStatus from "../components/UserInternalStatus";

// Types
interface Member {
	id: number;
	mid: number;
	eid: number;
	name: string;
	bind_value: string;
	status: number;
	from: number;
	created_time: number;
	updated_time: number;
	user_id: number;
	username: string;
	nickname: string;
	avatar: string;
	mobile: string;
	email: string;
	role: number;
	user_status: number;
	department_relations: {
		id: number;
		did: number;
		eid: number;
		bid: number;
		from: number;
		created_time: number;
		updated_time: number;
		name: string;
		bind_value: string;
	}[];
	dept_names?: string;
	dept_dids?: string;
	deleting?: boolean;
}

interface User {
	user_id: number;
	username: string;
	nickname: string;
	avatar: string;
	mobile: string;
	email: string;
	hide?: boolean;
}

interface MemberProps {
	syncFrom?: EnterpriseSyncFrom;
	department?: any;
	filterParams?: {
		keyword?: string;
		did?: number;
	};
}

export interface MemberRef {
	refresh: () => void;
}

/**
 * URL 持久化状态
 * 注：keyword 来自外部 props，不放入 URL
 */
interface MemberUrlState {
	status: number;
	page: number;
	pageSize: number;
}

// Status options
const getStatusOptions = (t: (key: string) => string) => [
	{ value: INTERNAL_USER_STATUS_ALL, label: t("internal_user.status.all") },
	{
		value: INTERNAL_USER_STATUS_UNDEFINED,
		label: t("internal_user.status.undefined"),
	},
	{
		value: INTERNAL_USER_STATUS_ENABLED,
		label: t("internal_user.status.enabled"),
	},
	{
		value: INTERNAL_USER_STATUS_DISABLED,
		label: t("internal_user.status.disabled"),
	},
];

export const UserMember = forwardRef<MemberRef, MemberProps>(
	(
		{
			syncFrom = ENTERPRISE_SYNC_FROM.DEFAULT,
			department = {},
			filterParams = {},
		},
		ref,
	) => {
		const enterpriseStore = useEnterpriseStore();
		const userStore = useUserStore();

		const [loading, setLoading] = useState(false);
		const [tableData, setTableData] = useState<Member[]>([]);
		const [tableTotal, setTableTotal] = useState(0);

		// 筛选 / 分页状态（URL 持久化；keyword 来自 props，不入 URL）
		const defaultUrlState = useMemo<MemberUrlState>(
			() => ({
				status: INTERNAL_USER_STATUS_ALL,
				page: 1,
				pageSize: 10,
			}),
			[],
		);
		const { state, stateRef, updateState } = useListState<MemberUrlState>(
			defaultUrlState,
			{ enableUrlSync: true, urlPrefix: "intl_mem_" },
		);

		// Relate state
		const [relateVisible, setRelateVisible] = useState(false);
		const [relateList, setRelateList] = useState<User[]>([]);
		const [relateKeyword, setRelateKeyword] = useState("");
		const [currentMember, setCurrentMember] = useState<Member | null>(null);

		// Dialog/Drawer refs
		const [addDialogOpen, setAddDialogOpen] = useState(false);
		const [editDrawerOpen, setEditDrawerOpen] = useState(false);
		const [editingMember, setEditingMember] = useState<Member | null>(null);

		// Computed
		const isSsoSync = useMemo(
			() => syncFrom !== ENTERPRISE_SYNC_FROM.DEFAULT,
			[syncFrom],
		);
		const isDingtalkSync = useMemo(
			() => syncFrom === ENTERPRISE_SYNC_FROM.DINGTALK,
			[syncFrom],
		);
		const statusOptions = useMemo(() => getStatusOptions(t), [t]);

		// Filtered relate list
		const filteredRelateList = useMemo(() => {
			if (!relateKeyword.trim()) return relateList;
			return relateList.filter(
				(item) =>
					item.nickname?.includes(relateKeyword.trim()) ||
					item.username?.includes(relateKeyword.trim()),
			);
		}, [relateList, relateKeyword]);

		// Fetch user list
		const fetchUserList = useCallback(async () => {
			if (loading) return;
			setLoading(true);
			const current = stateRef.current;

			try {
				const params: any = {
					status: INTERNAL_USER_STATUS_ALL,
					offset: (current.page - 1) * current.pageSize,
					limit: current.pageSize,
					from: syncFrom,
					user_status: current.status,
					keyword: filterParams.keyword || "",
					did: department.did,
				};

				const res = await userApi.organization(params);
				const data = (res.data?.data || []).map((item: Member) => {
					item.dept_names = (item.department_relations || [])
						.map((r) => r.name)
						.join(",");
					item.dept_dids = (item.department_relations || [])
						.map((r) => r.bind_value)
						.join(",");
					return item;
				});

				setTableData(data);
				setTableTotal(+res.data?.total_count || 0);
			} finally {
				setLoading(false);
			}
		}, [loading, syncFrom, department.did, filterParams.keyword, stateRef]);

		// Refresh
		const refresh = useCallback(() => {
			updateState({ page: 1 });
			fetchUserList();
		}, [updateState, fetchUserList]);

		// Load relate user list
		const loadRelateUserList = useCallback(async () => {
			const NO_BIND = 1;
			const res = await userApi.fetch_internal_user({
				limit: 1000,
				not_bind: NO_BIND,
				from: syncFrom,
			});
			setRelateList(res.list || []);
		}, [syncFrom]);

		// Handle add
		const handleAdd = () => {
			setAddDialogOpen(true);
		};

		// Handle edit
		const handleEdit = (record: Member) => {
			setEditingMember({
				...record,
				status: record.user_status,
				nickname: isDingtalkSync ? record.name : record.nickname,
			});
			setEditDrawerOpen(true);
		};

		// Handle delete
		const handleDelete = async (record: Member) => {
			try {
				if (isSsoSync) {
					await departmentApi.unbind_member({
						user_id: record.user_id,
						from: Number(syncFrom),
					});
				}
				await userApi.delete_user({ user_id: record.user_id });
				message.success(t("action_delete_success"));
				fetchUserList();
			} catch (error) {
				console.error("Delete user error:", error);
			}
		};

		// Handle bind
		const handleBind = async (user: User) => {
			if (!currentMember) return;

			Modal.confirm({
				title: t("tip"),
				content: t("sso.bind_member_tip"),
				onOk: async () => {
					await departmentApi.bind_member({
						bid: currentMember.id,
						user_id: user.user_id,
						from: Number(syncFrom),
					});
					message.success(t("action_bind_success"));
					loadRelateUserList();
					fetchUserList();
					setRelateVisible(false);
				},
			});
		};

		// Handle unbind
		const handleUnbind = async (record: Member) => {
			Modal.confirm({
				title: t("tip"),
				content: t("sso.unbind_member_tip"),
				onOk: async () => {
					await departmentApi.unbind_member({
						user_id: record.user_id,
						from: Number(syncFrom),
					});
					message.success(t("action_unbind_success"));
					loadRelateUserList();
					fetchUserList();
				},
			});
		};

		// Handle relate
		const handleRelate = (record: Member) => {
			setCurrentMember(record);
			setRelateKeyword("");
			loadRelateUserList();
			setRelateVisible(true);
		};

		// Handle row click
		const handleRowClick = (record: Member) => {
			if (record.user_id) {
				handleEdit(record);
			} else {
				handleRelate(record);
			}
		};

		// Table columns
		const columns: ColumnsType<Member> = useMemo(
			() => [
				{
					title: t("internal_user.account.nickname"),
					dataIndex: isDingtalkSync ? "name" : "nickname",
					key: "nickname",
					width: 180,
					render: (value: string, record: Member) => (
						<div className="flex items-center gap-1">
							{record.avatar ? (
								<img
									src={record.avatar}
									className="w-6 h-6 rounded-full"
									alt=""
								/>
							) : (
								<div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
									<UserOutlined className="text-gray-400 text-xs" />
								</div>
							)}
							<OpenData
								source={syncFrom}
								type="userName"
								openid={record.bind_value}
								text={isDingtalkSync ? record.name : value}
							/>
							{isSsoSync && (
								<>
									{record.user_id ? (
										<span className="text-gray-400">({record.nickname})</span>
									) : (
										<img
											src={getPublicPath(
												`/images/sso/${isDingtalkSync ? "dingtalk" : "wecom"}.png`,
											)}
											className="w-4 h-4"
											alt=""
										/>
									)}
								</>
							)}
						</div>
					),
				},
				{
					title: t("internal_user.account.mobile"),
					dataIndex: "mobile",
					key: "mobile",
					width: 140,
					render: (value: string) => (
						<span className={!value ? "text-gray-400" : ""}>
							{value || "--"}
						</span>
					),
				},
				{
					title: t("internal_user.account.department"),
					dataIndex: "dept_names",
					key: "department",
					width: 180,
					render: (value: string, record: Member) => (
						<OpenData
							source={syncFrom}
							type="departmentName"
							openid={record.dept_dids}
							text={value || enterpriseStore.info?.name || "--"}
						/>
					),
				},
				{
					title: t("internal_user.account.status"),
					dataIndex: "user_status",
					key: "status",
					width: 120,
					render: (value: number, record: Member) => (
						<UserStatus
							value={value}
							userData={record}
							onChange={() => fetchUserList()}
						/>
					),
				},
				{
					title: t("operation"),
					key: "operation",
					width: 130,
					fixed: "end",
					render: (_: any, record: Member) => (
						<div className="opacity-0 group-hover:opacity-100 transition-opacity">
							{record.user_id ? (
								<div className="flex items-center gap-1">
									<Button
										type="link"
										icon={<SvgIcon name="edit" />}
										onClick={(e) => {
											e.stopPropagation();
											handleEdit(record);
										}}
									/>
									<Dropdown
										menu={{
											items: [
												{
													key: "unbind",
													label: t("sso.unbind_member"),
													onClick: () => handleUnbind(record),
												},
												{
													key: "delete",
													label: t("action_delete"),
													danger: true,
													disabled:
														Number(record.user_id) ===
															Number(userStore.info?.user_id) || isSsoSync,
													onClick: () => {
														Modal.confirm({
															title: t("tip"),
															content: t(
																"module.operation_user_delete_confirm",
															),
															onOk: () => handleDelete(record),
														});
													},
												},
											],
										}}
										trigger={["click"]}
									>
										<Button
											type="link"
											icon={<MoreOutlined />}
											onClick={(e) => e.stopPropagation()}
										/>
									</Dropdown>
								</div>
							) : (
								<Button
									type="link"
									onClick={(e) => {
										e.stopPropagation();
										handleRelate(record);
									}}
								>
									{t("sso.bind_member")}
								</Button>
							)}
						</div>
					),
				},
			],
			[
				t,
				isDingtalkSync,
				isSsoSync,
				enterpriseStore.info?.name,
				userStore.info?.user_id,
				fetchUserList,
			],
		);

		// Expose refresh
		useImperativeHandle(ref, () => ({
			refresh,
		}));

		// 部门切换时重置到第 1 页
	useEffect(() => {
		updateState({ page: 1 });
	}, [department.did]);

	// 监听 URL 状态变化，重新加载数据
		const stateKey = JSON.stringify(state);
		useEffect(() => {
			fetchUserList();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [stateKey, department.did, filterParams.keyword]);

		return (
			<div className="h-full flex flex-col bg-white py-6 px-5 overflow-hidden">
				{/* Header */}
				<div className="flex items-center gap-2 mb-4">
					<h3 className="text-xl text-gray-800 truncate">
						<OpenData
							source={syncFrom}
							type="departmentName"
							openid={
								department.bind_value && department.bind_value > 0
									? String(department.bind_value)
									: "0"
							}
							text={department.name || enterpriseStore.info?.name || ""}
						/>
						<span className="text-gray-500 ml-2">
							(
							{t("internal_user.department.member_total_count", {
								total: tableTotal,
							})}
							)
						</span>
					</h3>
				</div>

				{/* Filters */}
				<div className="flex items-center justify-between mb-4">
					<Select
						value={state.status}
						onChange={(value) => updateState({ status: value })}
						style={{ width: 180 }}
						prefix={<span className="text-[rgb(168 171 178)]">状态：</span>}
					>
						{statusOptions.map((opt) => (
							<Select.Option key={opt.value} value={opt.value}>
								{opt.label}
							</Select.Option>
						))}
					</Select>

					{!isSsoSync && (
						<Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
							{t("action_add")}
						</Button>
					)}
				</div>

				{/* Table */}
				<div className="flex-1 overflow-auto">
					<Table
						rowKey="id"
						columns={columns}
						dataSource={tableData}
						loading={loading}
						pagination={{
							current: state.page,
							pageSize: state.pageSize,
							total: tableTotal,
							showSizeChanger: true,
							showTotal: (total) => t("table_footer_text", { total }),
							onChange: (page, pageSize) => {
								updateState({ page, pageSize });
							},
						}}
						rowClassName="group cursor-pointer hover:bg-gray-50"
						onRow={(record) => ({
							onClick: () => handleRowClick(record),
						})}
						scroll={{ x: "max-content" }}
					/>
				</div>

				{/* Add Dialog */}
				<UserAddDialog
					open={addDialogOpen}
					onClose={() => setAddDialogOpen(false)}
					onSuccess={() => {
						setAddDialogOpen(false);
						refresh();
					}}
				/>

				{/* Edit Drawer */}
				<UserEditDrawer
					open={editDrawerOpen}
					data={editingMember}
					onClose={() => {
						setEditDrawerOpen(false);
						setEditingMember(null);
					}}
					onSuccess={() => {
						setEditDrawerOpen(false);
						setEditingMember(null);
						fetchUserList();
					}}
				/>

				{/* Relate Member Modal */}
				<Modal
					open={relateVisible}
					title={t("sso.bind_member")}
					onCancel={() => setRelateVisible(false)}
					footer={null}
					width={200}
				>
					<div className="mb-3">
						<Search
							mode="expanded"
							value={relateKeyword}
							onDebouncedChange={setRelateKeyword}
							placeholder={t("action_search")}
							className="w-full"
						/>
					</div>
					<div className="max-h-[200px] overflow-y-auto">
						{filteredRelateList.length === 0 ? (
							<div className="text-center text-gray-400 py-4">
								{t("no_data")}
							</div>
						) : (
							filteredRelateList.map((user) => (
								<div
									key={user.user_id}
									className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded text-sm truncate"
									onClick={() => handleBind(user)}
								>
									{user.nickname || user.username || "--"}
								</div>
							))
						)}
					</div>
				</Modal>
			</div>
		);
	},
);

export default UserMember;
