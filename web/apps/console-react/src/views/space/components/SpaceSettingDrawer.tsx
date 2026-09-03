import { Button, Drawer, Modal, Spin, Tabs } from "antd";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { spacesApi } from "@/api/modules/spaces";
import type { SpaceDisplayItem, SpaceItem } from "@/api/modules/spaces/types";
import { BasicInfoTab } from "@/views/space/setting/pages/basic-info";
import { MembersTab } from "@/views/space/setting/pages/members";
import { KnowledgeTab } from "@/views/space/setting/pages/knowledge";
import {
	SPACE_SETTING_FOOTER_TAB_KEYS,
	type SpaceSettingTabKey,
	type TabActionsRef,
	type TabState,
} from "@/views/space/setting/types";
import { t } from "@/locales";

export interface SpaceSettingDrawerRef {
	open: (item: SpaceDisplayItem | SpaceItem, tab?: string) => void;
	close: () => void;
}

export interface SpaceSettingDrawerProps {}

const TAB_KEYS = [
	"basic-info",
	"members",
	"knowledge",
] as const;

type TabKey = SpaceSettingTabKey;

function SpaceSettingDrawerInner(
	props: SpaceSettingDrawerProps,
	ref: React.ForwardedRef<SpaceSettingDrawerRef>,
) {
	const [open, setOpen] = useState(false);
	const [space, setSpace] = useState<SpaceItem | null>(null);
	const [loading, setLoading] = useState(false);
	const [activeTab, setActiveTab] = useState<TabKey>("basic-info");

	// 每个需要底部 footer 的 tab 一个 ref，drawer 直接调用其 save/reset
	const basicInfoRef = useRef<TabActionsRef>(null);

	const tabRefs: Record<SpaceSettingTabKey, React.RefObject<TabActionsRef | null>> = useMemo(
		() => ({
			"basic-info": basicInfoRef,
			members: { current: null } as React.RefObject<TabActionsRef | null>,
			knowledge: { current: null } as React.RefObject<TabActionsRef | null>,
		}),
		[],
	);

	const [tabState, setTabState] = useState<TabState>({
		dirty: false,
		saving: false,
	});

	// 切换 tab / 初次打开时，主动从 ref 拉取当前 tab 的状态（因为 useEffect 同步只在新 dirty/saving 变化时触发）
	useEffect(() => {
		const ref = tabRefs[activeTab]?.current;
		if (ref?.getState) {
			setTabState(ref.getState());
		} else {
			setTabState({ dirty: false, saving: false });
		}
	}, [activeTab, tabRefs]);

	const handleStateChange = useCallback((next: TabState) => {
		setTabState(next);
	}, []);

	const loadSpace = useCallback(async (id: string) => {
		setLoading(true);
		try {
			const res = (await spacesApi.detail(id)) as SpaceItem;
			setSpace(res);
		} catch (error) {
			console.error("Load space detail error:", error);
			setSpace(null);
		} finally {
			setLoading(false);
		}
	}, []);

	const handleOpen = useCallback(
		(item: SpaceDisplayItem | SpaceItem, tab?: string) => {
			setOpen(true);
			setActiveTab(
				tab && (TAB_KEYS as readonly string[]).includes(tab)
					? (tab as TabKey)
					: "basic-info",
			);
			if (item.id) {
				loadSpace(item.id);
			}
		},
		[loadSpace],
	);

	const handleClose = useCallback(() => {
		setOpen(false);
		setSpace(null);
		setTabState({ dirty: false, saving: false });
	}, []);

	useImperativeHandle(
		ref,
		() => ({ open: handleOpen, close: handleClose }),
		[handleOpen, handleClose],
	);

	const handleRefresh = useCallback(async () => {
		if (!space) return;
		await loadSpace(space.id);
	}, [space, loadSpace]);

	const showFooter = SPACE_SETTING_FOOTER_TAB_KEYS.includes(activeTab);

	const handleDrawerSave = useCallback(async () => {
		const ref = tabRefs[activeTab]?.current;
		if (!ref) return;
		await ref.save();
	}, [activeTab, tabRefs]);

	// 底部「取消」= 关闭抽屉；有未保存改动时先弹确认，确定后与右上角关闭行为一致
	const handleConfirmLeave = useCallback(() => {
		if (tabState.dirty) {
			Modal.confirm({
				title: t("common.tip"),
				content: t("common.unsaved_confirm_message"),
				centered: true,
				okText: t("action.confirm"),
				cancelText: t("action.cancel"),
				onOk: () => handleClose(),
			});
		} else {
			handleClose();
		}
	}, [tabState.dirty, handleClose]);

	const tabItems = space
		? [
				{
					key: "basic-info",
					label: t("space.setting.menu.basicInfo"),
					children: (
						<BasicInfoTab
							space={space}
							onRefresh={handleRefresh}
							tabRef={basicInfoRef}
							onStateChange={handleStateChange}
						/>
					),
				},
				{
					key: "members",
					label: t("space.setting.menu.members"),
					children: (
						<MembersTab space={space} onRefresh={handleRefresh} />
					),
				},
				{
					key: "knowledge",
					label: t("space.setting.menu.knowledge"),
					children: (
						<KnowledgeTab space={space} onRefresh={handleRefresh} />
					),
				},
			]
		: [];

	const footer = showFooter ? (
		<div className="flex items-center justify-end gap-2 ">
			<Button onClick={handleConfirmLeave}>
				{t("action.cancel")}
			</Button>
			<Button
				type="primary"
				loading={tabState.saving}
				disabled={!tabState.dirty}
				onClick={handleDrawerSave}
			>
				{t("action.save")}
			</Button>
		</div>
	) : null;

	return (
		<Drawer
			open={open}
			onClose={handleConfirmLeave}
			title={t("space.setting.title")}
			size={1000}
			footer={footer}
			styles={{
				body: {
					'--ant-padding-lg':  '0px 24px',
				},
			}}
			destroyOnClose={false}
		>
			{loading || !space ? (
				<div className="h-full flex items-center justify-center">
					<Spin />
				</div>
			) : (
				<div className="h-full -mx-6 px-6">
					<Tabs
						activeKey={activeTab}
						onChange={(key) => setActiveTab(key as TabKey)}
						items={tabItems}
						tabBarStyle={{
							marginBottom: 16,
							position: 'sticky',
							top: 0,
							zIndex: 10,
							backgroundColor: '#fff',
						}}
					/>
				</div>
			)}
		</Drawer>
	);
}


export const SpaceSettingDrawer = forwardRef<
	SpaceSettingDrawerRef,
	SpaceSettingDrawerProps
>(SpaceSettingDrawerInner);

export default SpaceSettingDrawer;
