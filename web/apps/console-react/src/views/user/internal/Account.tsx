import { MoreOutlined } from "@ant-design/icons";
import { Dropdown, Search, SvgIcon } from "@km/shared-components-react";
import { Button, Modal, message, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { groupApi, userApi } from "@/api";
import {
	INTERNAL_USER_STATUS_ALL,
	INTERNAL_USER_STATUS_DISABLED,
	INTERNAL_USER_STATUS_ENABLED,
	INTERNAL_USER_STATUS_LABEL_MAP,
	INTERNAL_USER_STATUS_UNDEFINED,
} from "@/api/modules/user";
import type { DialogueRecordDrawerRef } from "@/components/DialogueRecord/drawer";
import { DialogueRecordDrawer } from "@/components/DialogueRecord/drawer";
import {
	ENTERPRISE_SYNC_FROM,
	type EnterpriseSyncFrom,
	VERSION_MODULE,
} from "@/constants/enterprise";
import { GROUP_TYPE, type Group } from "@/constants/group";
import { useListState, useVersion } from "@/hooks";
import { useEnv } from "@/hooks/useEnv";
import { t } from "@/locales";
import { useEnterpriseStore, useUserStore } from "@/stores";
import UserAddDialog from "../components/UserInternalAddDialog";
import UserEditDrawer from "../components/UserInternalEditDrawer";
import UserStatus from "../components/UserInternalStatus";

// Types
interface AccountUser {
	user_id: number;
	nickname: string;
	mobile: string;
	email: string;
	dept_names?: string;
	departments?: { name: string; did: number }[];
	group_ids?: number[];
	group_names?: string;
	status: number;
	deleting?: boolean;
	memberbindings?: { name: string }[];
}

interface AccountRef {
	refresh: () => void;
}

interface AccountProps {
	syncFrom?: EnterpriseSyncFrom;
	onDataChange?: () => void;
	internalUserCount?: number;
}

/**
 * URL 持久化状态
 */
interface AccountUrlState {
	status: number;
	keyword: string;
	page: number;
	pageSize: number;
}

// Status options
const getStatusOptions = () =>
	[
		INTERNAL_USER_STATUS_ALL,
		INTERNAL_USER_STATUS_UNDEFINED,
		INTERNAL_USER_STATUS_ENABLED,
		INTERNAL_USER_STATUS_DISABLED,
	].map((value) => ({
		value,
		label: t(INTERNAL_USER_STATUS_LABEL_MAP.get(value) || ""),
	}));

export const UserAccount = forwardRef<AccountRef, AccountProps>(
	({ syncFrom = ENTERPRISE_SYNC_FROM.DEFAULT, onDataChange }, ref) => {
		const enterpriseStore = useEnterpriseStore();
		const userStore = useUserStore();
		const { isWorkEnv } = useEnv();

		// User info
		const userInfo = useMemo(() => userStore.info, [userStore.info]);

		// 列表数据状态（本地）
		const [loading, setLoading] = useState(false);
		const [tableData, setTableData] = useState<AccountUser[]>([]);
		const [tableTotal, setTableTotal] = useState(0);

		// 筛选 / 分页状态（URL 持久化）
		const defaultUrlState = useMemo<AccountUrlState>(
			() => ({
				status: INTERNAL_USER_STATUS_ALL,
				keyword: "",
				page: 1,
				pageSize: 10,
			}),
			[],
		);
		const { state, stateRef, updateState } = useListState<AccountUrlState>(
			defaultUrlState,
			{ enableUrlSync: true, urlPrefix: "intl_acc_" },
		);

		// Group map state
		const [groupData, setGroupData] = useState<Record<number, string>>({});
		const groupDataRef = useRef<Record<number, string>>({});
		groupDataRef.current = groupData;

		// Dialog/Drawer state
		const [addDialogOpen, setAddDialogOpen] = useState(false);
		const [editDrawerOpen, setEditDrawerOpen] = useState(false);
		const [editingUser, setEditingUser] = useState<AccountUser | null>(null);
		const dialogueRecordRef = useRef<DialogueRecordDrawerRef>(null);

		const statusOptions = useMemo(() => getStatusOptions(), []);

		// Version limit check
		const { guard: guardInternalUserVersion } = useVersion({
			module: VERSION_MODULE.INTERNAL_USER,
			count: tableTotal,
			content: t("version.internal_user_limit"),
		});

		const isSsoSync = useMemo(
			() => syncFrom !== ENTERPRISE_SYNC_FROM.DEFAULT,
			[syncFrom],
		);

		// Fetch group data
		const fetchGroupData = useCallback(async () => {
			const list = await groupApi.list({
				params: { group_type: GROUP_TYPE.INTERNAL_USER },
			});
			const groupMap: Record<number, string> = {};
			list.forEach((item: Group) => {
				groupMap[item.group_id] = item.group_name;
			});
			groupDataRef.current = groupMap;
			setGroupData(groupMap);
		}, []);

		// Fetch user list
		const fetchUserList = useCallback(async () => {
			if (loading) return;
			setLoading(true);

			const current = stateRef.current;
			try {
				const params: any = {
					status: current.status,
					keyword: current.keyword,
					offset: (current.page - 1) * current.pageSize,
					limit: current.pageSize,
					from: syncFrom,
				};

				if (params.status < 0) delete params.status;

				const { total = 0, list = [] } =
					await userApi.fetch_internal_user(params);

				const formattedList = list.map((item: any) => {
					item.group_names = (item.group_ids ?? [])
						.reduce((names: string[], id: number) => {
							const name = groupDataRef.current[id];
							if (name) names.push(name);
							return names;
						}, [])
						.join("、");
					return item;
				});

				setTableData(formattedList);
				setTableTotal(+total || 0);
			} finally {
				setLoading(false);
			}
		}, [loading, syncFrom, stateRef]);

		// Refresh
		const refresh = useCallback(() => {
			updateState({ page: 1 });
			fetchUserList();
		}, [updateState, fetchUserList]);

		// Handle add
		const handleAdd = () => {
			if (guardInternalUserVersion()) {
				setAddDialogOpen(true);
			}
		};

		// Handle edit
		const handleEdit = (record: AccountUser) => {
			setEditingUser(record);
			setEditDrawerOpen(true);
		};

		// Handle delete
		const handleDelete = async (record: AccountUser) => {
			Modal.confirm({
				title: t("tip"),
				content: t("module.operation_user_delete_confirm"),
				onOk: async () => {
					try {
						await userApi.delete_user({ user_id: record.user_id });
						message.success(t("action_delete_success"));
						fetchUserList();
						onDataChange?.();
					} catch (error) {
						console.error("Delete user error:", error);
					}
				},
			});
		};

		// Handle more commands
		const handleMoreCommand = (key: string, record: AccountUser) => {
			switch (key) {
				case "dialogue_record":
					dialogueRecordRef.current?.open({
						type: "user",
						relatedId: record.user_id,
					});
					break;
				case "delete":
					handleDelete(record);
					break;
			}
		};

		// Handle row click
		const handleRowClick = (record: AccountUser) => {
			handleEdit(record);
		};

		// Table columns
		const columns: ColumnsType<AccountUser> = useMemo(
			() => [
				{
					title: t("internal_user.account.nickname"),
					dataIndex: "nickname",
					key: "nickname",
					width: 140,
					ellipsis: true,
				},
				{
					title: t("internal_user.account.mobile"),
					dataIndex: "mobile",
					key: "mobile",
					width: 140,
					render: (value: string) => (
						<span className={!value ? "text-disabled" : ""}>
							{value || "--"}
						</span>
					),
				},
				{
					title: t("internal_user.account.department"),
					dataIndex: "dept_names",
					key: "department",
					width: 140,
					render: (value: string) =>
						value || enterpriseStore.info?.name || "--",
				},
				{
					title: t("internal_user.group.title"),
					dataIndex: "group_names",
					key: "group",
					width: 140,
					render: (value: string) => value || "--",
				},
				{
					title: t("internal_user.account.status"),
					dataIndex: "status",
					key: "status",
					width: 140,
					render: (value: number, record: AccountUser) => (
						<UserStatus
							value={value}
							userData={record}
							buttonDisabled={
								record.user_id === userInfo?.user_id || record.is_creator
							}
							onChange={() => fetchUserList()}
						/>
					),
				},
				{
					title: t("operation"),
					key: "operation",
					width: 120,
					fixed: "end",
					render: (_: any, record: AccountUser) => (
						<div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
							<Button
								type="link"
								icon={<SvgIcon name="edit" />}
								onClick={(e) => {
									e.stopPropagation();
									handleEdit(record);
								}}
							/>
							{isWorkEnv ? (
								<Button
									type="link"
									danger
									icon={<SvgIcon name="delete" />}
									disabled={record.user_id === userStore.info?.user_id}
									onClick={(e) => {
										e.stopPropagation();
										handleDelete(record);
									}}
								>
									{record.user_id === userStore.info?.user_id
										? "--"
										: t("action_delete")}
								</Button>
							) : (
								<Dropdown
									menu={{
										items: [
											{
												key: "dialogue_record",
												label: t("dialogue_record"),
											},
											{
												key: "delete",
												label: t("action_delete"),
												danger: true,
												disabled: record.user_id === userStore.info?.user_id,
											},
										],
										onClick: ({ key }) => handleMoreCommand(key, record),
									}}
									trigger={["click"]}
								>
									<Button
										type="link"
										icon={<MoreOutlined />}
										onClick={(e) => e.stopPropagation()}
									/>
								</Dropdown>
							)}
						</div>
					),
				},
			],
			[
				t,
				enterpriseStore.info?.name,
				userStore.info?.user_id,
				fetchUserList,
				isWorkEnv,
			],
		);

		// Expose refresh
		useImperativeHandle(ref, () => ({
			refresh,
		}));

		// 是否已初始化（确保 group 数据先就绪）
		const initializedRef = useRef(false);

		// 监听 URL 状态变化，重新加载数据
		const stateKey = JSON.stringify(state);
		useEffect(() => {
			if (!initializedRef.current) return;
			fetchUserList();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [stateKey]);

		// 初始化：先加载分组数据，再加载用户列表
		useEffect(() => {
			const init = async () => {
				await fetchGroupData();
				initializedRef.current = true;
				fetchUserList();
			};
			init();
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		return (
			<div className="max-h-full flex flex-col bg-white overflow-auto">
				{/* Filters */}
				<div className="flex items-center justify-between">
					<Select
						value={state.status}
						onChange={(value) => updateState({ status: value })}
						style={{ width: 180 }}
					>
						{statusOptions.map((opt) => (
							<Select.Option key={opt.value} value={opt.value}>
								{opt.label}
							</Select.Option>
						))}
					</Select>

					<div className="flex gap-3">
						<Search
							mode="expanded"
							value={state.keyword}
							onDebouncedChange={(val) => updateState({ keyword: val })}
							placeholder={t("internal_user.account.search_placeholder")}
							className="w-[268px]"
						/>
						{!isSsoSync && (
							<Button type="primary" onClick={handleAdd}>
								{t("action_add")}
							</Button>
						)}
					</div>
				</div>

				{/* Table */}
				<div className="flex-1 overflow-y-auto bg-white rounded-lg px-2 mt-4">
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
							onChange: (page, pageSize) => {
								updateState({ page, pageSize });
							},
						}}
						rowClassName="group cursor-pointer hover:bg-gray-50"
						scroll={{ x: "max-content" }}
						onRow={(record) => ({
							onClick: () => handleRowClick(record),
						})}
					/>
				</div>

				{/* Add Dialog */}
				<UserAddDialog
					open={addDialogOpen}
					onClose={() => setAddDialogOpen(false)}
					onSuccess={() => {
						setAddDialogOpen(false);
						refresh();
						onDataChange?.();
					}}
				/>

				{/* Edit Drawer */}
				<UserEditDrawer
					open={editDrawerOpen}
					data={editingUser}
					onClose={() => {
						setEditDrawerOpen(false);
						setEditingUser(null);
					}}
					onSuccess={() => {
						setEditDrawerOpen(false);
						setEditingUser(null);
						fetchUserList();
					}}
				/>

				{/* Dialogue Record Drawer */}
				<DialogueRecordDrawer ref={dialogueRecordRef} />
			</div>
		);
	},
);

export default UserAccount;
