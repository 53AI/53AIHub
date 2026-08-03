import { UserOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { eventBus } from "@km/shared-utils";
import { Avatar, Badge, Button, Menu, Skeleton, Tooltip } from "antd";
import {
	createPortal,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Link,
	Outlet,
	useLocation,
	useMatches,
	useNavigate,
} from "react-router-dom";
import notificationsApi from "@/api/modules/notifications";
import { MoreDropdown } from "@/components/MoreDropdown";
import { VERSION_MODULE } from "@/constants/enterprise";
import { EVENT_NAMES } from "@/constants/events";
import { NAVIGATION_TARGET, NAVIGATION_TYPE } from "@/constants/navigation";
import { SidebarContext } from "@/contexts/SidebarContext";
import { useMultiAccountGuard } from "@/hooks/useMultiAccountGuard";
import { useResponsive } from "@/hooks/useResponsive";
import { t } from "@/locales";
import { recordingChannel } from "@/services/recording-channel";
import { wakeLockService } from "@/services/wake-lock";
import {
	useEnterpriseStore,
	useIsSoftStyle,
} from "@/stores/modules/enterprise";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useRecordingStore } from "@/stores/modules/recording";
import {
	navigateAgentShortcut,
	useShortcutsStore,
} from "@/stores/modules/shortcuts";
import { useUserStore } from "@/stores/modules/user";
import { api_host } from "@/utils/config";
import { checkPermission } from "@/utils/permission";
import { buildUrl } from "@/utils/router";
import { checkVersion } from "@/utils/version";
import "./layout.css";

// Lazy load heavy components
const Banner = lazy(() =>
	import("@/components/Layout/Banner").then((m) => ({ default: m.Banner })),
);
const MessageCenter = lazy(() =>
	import("@/components/Layout/MessageCenter").then((m) => ({
		default: m.MessageCenter,
	})),
);
const ProfilePopover = lazy(() =>
	import("@/components/Layout/ProfilePopover").then((m) => ({
		default: m.ProfilePopover,
	})),
);

const ProfileModal = lazy(() => import("@/views/profile"));
const RecordingFloat = lazy(() =>
	import("@/components/RecordingFloat").then((m) => ({
		default: m.RecordingFloat,
	})),
);

export function Layout() {
	const location = useLocation();
	const matches = useMatches();
	const navigate = useNavigate();
	const siderRef = useRef<HTMLDivElement>(null);
	const mainRef = useRef<HTMLDivElement>(null);

	const [showSider, setShowSider] = useState(true);
	const [siderVisible, setSiderVisible] = useState(false);
	const [showProfile, setShowProfile] = useState(false);
	const [messageCenterReady, setMessageCenterReady] = useState(false);
	const [teleportReady, setTeleportReady] = useState(false);
	const [unreadCount, setUnreadCount] = useState(0);

	const userStore = useUserStore();
	const enterpriseStore = useEnterpriseStore();
	const navigationStore = useNavigationStore();
	const shortcutsStore = useShortcutsStore();
	const isSoftStyle = useIsSoftStyle();
	const { isMobile } = useResponsive();
	const recordingConfig = useRecordingStore((s) => s.recordingConfig);

	// 紧凑模式判断：软件模式 + 非知识库页面 + 非移动端
	const isKnowledgePage = location.pathname.startsWith("/library");
	const useCompactMode = isSoftStyle && !isKnowledgePage && !isMobile;

	// 多账号登录冲突检测
	useMultiAccountGuard();

	const activePath = location.pathname;
	const hasKnowledge = navigationStore.hasKnowledge;
	const includeKm = window.$vars?.includeKm ?? true;

	// Compute effective path for navigation matching
	// /chat with agent_id param should match /agent navigation
	const effectivePath = useMemo(() => {
		if (activePath === "/chat") {
			const searchParams = new URLSearchParams(location.search);
			if (searchParams.has("agent_id")) {
				return "/agent";
			}
		}
		return activePath;
	}, [activePath, location.search]);

	// 当前是否位于 webview 路由，及其指向的外部 URL
	// 用于外部链接菜单项的 active 判定，避免点击后无高亮
	const currentWebviewUrl = useMemo(() => {
		if (location.pathname !== "/webview") return null;
		return new URLSearchParams(location.search).get("url");
	}, [location.pathname, location.search]);

	const shouldShowBanner =
		!isSoftStyle && matches.some((match) => (match.handle as any)?.banner);

	// Computed: show mine menu (including document, agent, skill, recording)
	const showMineMenu =
		userStore.is_login &&
		((hasKnowledge && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE)) ||
			checkVersion(VERSION_MODULE.RECORDING) ||
			checkVersion(VERSION_MODULE.AGENT));

	const showRecordingMenu = false

	// Computed: navigations with is_internal filter
	const navigations = navigationStore.navigations
		.filter((item) => +item.status)
		.filter((item) =>
			item.jump_path === "/knowledge" ? userStore.info.is_internal : true,
		)
		// 软件模式下不展示首页
		.filter((item) => !(isSoftStyle && item.jump_path === "/index"))
		.filter((item) => item.jump_path !== "/___placeholder");

	// 导航项 active 判定：
	// - 外部链接：通过当前 webview 路由 + url 参数匹配
	// - 普通路由：按 menu_path 前缀匹配
	const isNavItemActive = (item: Navigation.State): boolean => {
		if (item.type === NAVIGATION_TYPE.EXTERNAL) {
			return currentWebviewUrl === item.url;
		}
		return effectivePath.startsWith(item.menu_path);
	};

	// Header Menu 的 selectedKeys：位于 webview 时，按 url 匹配回写到对应 nav 的 menu_path
	const menuSelectedKey = useMemo(() => {
		if (location.pathname === "/webview" && currentWebviewUrl) {
			const matched = navigations.find(
				(item) =>
					item.type === NAVIGATION_TYPE.EXTERNAL &&
					item.url === currentWebviewUrl,
			);
			if (matched) return matched.menu_path;
		}
		return effectivePath;
	}, [currentWebviewUrl, effectivePath, navigations, location.pathname]);

	// Handle login success event
	const handleLoginSuccess = useCallback(() => {
		const redirect = new URLSearchParams(location.search).get("redirect");
		if (redirect) {
			navigate(redirect);
		}
		shortcutsStore.loadShortcuts();
		enterpriseStore.loadSaasInfo();
	}, [location.search, navigate]);

	useEffect(() => {
		eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
		return () => {
			eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
		};
	}, [handleLoginSuccess]);

	// Fetch unread message count for compact mode
	useEffect(() => {
		// 只在紧凑模式下获取未读消息统计（正常模式由 MessageCenter 自己处理）
		if (!useCompactMode || !userStore.is_login || !hasKnowledge) {
			setUnreadCount(0);
			return;
		}

		const fetchUnreadCount = async () => {
			try {
				const response = await notificationsApi.stats({ scope: "unread" });
				setUnreadCount(response.total);
			} catch (error) {
				console.error("获取未读消息统计失败:", error);
			}
		};

		fetchUnreadCount();
		const timer = setInterval(fetchUnreadCount, 60000);

		return () => clearInterval(timer);
	}, [useCompactMode, userStore.is_login, hasKnowledge]);

	// Initial load
	useEffect(() => {
		shortcutsStore.loadShortcuts();
		// Delay load message center
		setTimeout(() => setMessageCenterReady(true), 1000);
	}, []);

	// Load recording config when user is logged in
	useEffect(() => {
		if (userStore.is_login) {
			useRecordingStore.getState().loadConfig();
		}
	}, [userStore.is_login]);

	// Initialize recording channel listeners
	useEffect(() => {
		const { _initChannelListeners, fetchActive, _setBlockedByOtherTab } =
			useRecordingStore.getState();
		_initChannelListeners();

		// Check if another tab is recording before fetching active state
		recordingChannel.checkOtherTabRecording().then(({ busy }) => {
			if (busy) {
				_setBlockedByOtherTab(true);
				// Don't call fetchActive() - another tab is recording
			} else {
				fetchActive(); // Check for active/interrupted recording on page load
			}
		});

		// Wake Lock visibility change handler
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				wakeLockService.handleVisibilityChange();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);

		// Network state listeners
		const handleOnline = () => {
			useRecordingStore.getState()._setNetworkOffline(false);
		};
		const handleOffline = () => {
			useRecordingStore.getState()._setNetworkOffline(true);
		};
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		// Wake Lock release callback
		const unsubWakeLock = wakeLockService.onReleased(() => {
			useRecordingStore.getState()._onWakeLockReleased();
		});

		// Page unload handler - handle recording state when user leaves
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			const state = useRecordingStore.getState();
			const jobId = state.jobId;
			const token = userStore.info.access_token;

			if (!jobId || !token) return;

			// Check if other pages have beforeunload protection (e.g., editing pages)
			// If so, silently interrupt without showing our own prompt
			const hasOtherProtection = (window as any).__hasBeforeUnloadProtection__;

			// Only handle recording state (paused state can be recovered after refresh)
			if (state.status === "recording") {
				// 触发 requestData() 尝试保存当前 segment 到 IDB
				const bridge = state._bridge;
				if (bridge && (bridge as any).mediaRecorder?.state === "recording") {
					try {
						(bridge as any).mediaRecorder.requestData();
					} catch {
						// 忽略错误
					}
				}

				// Recording: call interrupt to mark as interrupted (user can recover later)
				fetch(`${api_host}/api/recordings/${jobId}/state`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ action: "interrupt" }),
					keepalive: true,
				}).catch(() => {
					// Ignore errors during page unload
				});

				// If other pages have protection, don't show our prompt (silently interrupt)
				if (hasOtherProtection) return;

				e.preventDefault();
				e.returnValue = "录音正在进行中，离开将中断录音，确定要离开吗？";
				return e.returnValue;
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("beforeunload", handleBeforeUnload);
			unsubWakeLock();
		};
	}, []);

	// Check teleport target on route change
	useEffect(() => {
		const checkTeleportTarget = () => {
			const target = document.querySelector(".header-before-prefix");
			setTeleportReady(!!target);
		};
		// Initial check with delay to allow page header to render
		const timer = setTimeout(checkTeleportTarget, 100);
		return () => clearTimeout(timer);
	}, [location.pathname]);

	// Handle sider visibility based on screen size
	useEffect(() => {
		if (isSoftStyle && isMobile) {
			setShowSider(false);
			setSiderVisible(false);
		} else if (isSoftStyle) {
			setShowSider(!isMobile);
		}
	}, [isSoftStyle, isMobile]);

	// Click outside to close sidebar
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			// Mobile: close when clicking outside expanded sidebar
			if (isMobile && siderVisible) {
				if (siderRef.current && !siderRef.current.contains(e.target as Node)) {
					setSiderVisible(false);
				}
			}
			// Desktop: close hover-expanded sidebar when clicking outside
			if (!isMobile && !showSider && siderVisible) {
				if (siderRef.current && !siderRef.current.contains(e.target as Node)) {
					setSiderVisible(false);
				}
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isMobile, showSider, siderVisible]);

	// Close profile on route change
	useEffect(() => {
		setShowProfile(false);
	}, [location.pathname]);

	const handleSiderVisibility = useCallback(
		(visible: boolean) => {
			if (isMobile && !visible) return;
			if (!showSider) setSiderVisible(visible);
		},
		[isMobile, showSider],
	);

	const handleToggle = useCallback(() => {
		if (isMobile && isSoftStyle) {
			setSiderVisible(!siderVisible);
			return;
		}
		setShowSider(!showSider);
		if (showSider) setSiderVisible(false);
	}, [isMobile, isSoftStyle, showSider, siderVisible]);

	const handleLogin = async () => {
		await checkPermission();
	};

	const handleProfile = () => {
		setShowProfile(true);
		if (isMobile) setSiderVisible(false);
	};

	const handleNavigationClick = (item: Navigation.State) => {
		if (item.type === NAVIGATION_TYPE.EXTERNAL) {
			if (item.target === NAVIGATION_TARGET.BLANK) {
				// 外部链接 - 新窗口打开
				window.open(item.url, "_blank");
			} else {
				// 外部链接 - 当前窗口：走 webview 路由，保持 SPA 内导航（参考 layout.vue：内部跳转走 /webview）
				navigate(`/webview?url=${encodeURIComponent(item.url)}`);
			}
		} else if (item.target === NAVIGATION_TARGET.BLANK) {
			window.open(item.url, "_blank");
		}
	};

	const getIconColor = (bool: boolean) => (bool ? "#2563EB" : "#979799");
	const getBlockColor = (bool: boolean) =>
		bool ? "bg-[#E7EFFB] text-[#2563EB]" : "text-[#979799]";

	const handleShortcutClick = async (shortcut: any) => {
		if (isMobile) setSiderVisible(false);

		// ai_link 类型直接打开链接
		if (shortcut.type === "ai_link") {
			window.open(shortcut.url, "_blank");
			return;
		}

		// 非 agent 类型使用原有路由逻辑
		if (shortcut.type !== "agent") {
			const routePath = shortcutsStore.getShortcutRoute(shortcut);
			window.open(buildUrl(routePath), "_blank");
			return;
		}

		// agent 类型使用统一的跳转逻辑
		await navigateAgentShortcut({
			agentId: shortcut.related_id,
			isSoftStyle,
			navigate,
		});
	};

	const handleShortcutCommand = async (command: string, shortcut: any) => {
		if (command === "new-tab") {
			// ai_link 类型直接打开链接
			if (shortcut.type === "ai_link") {
				window.open(shortcut.url, "_blank");
				return;
			}

			// 非 agent 类型使用原有路由逻辑
			if (shortcut.type !== "agent") {
				const routePath = shortcutsStore.getShortcutRoute(shortcut);
				window.open(buildUrl(routePath), "_blank");
				return;
			}

			// agent 类型使用统一的跳转逻辑
			await navigateAgentShortcut({
				agentId: shortcut.related_id,
				isSoftStyle,
				navigate,
			});
		} else if (command === "remove") {
			try {
				await shortcutsStore.removeShortcut(shortcut.type, shortcut.related_id);
				// message success handled in store
			} catch (error) {
				// message error handled in store
			}
		}
	};

	// Website style header
	if (!isSoftStyle) {
		return (
			<div className="h-full flex flex-col relative">
				<header className="flex-none h-[70px] border-b sticky top-0 z-10 nav-bg">
					<div className="flex items-center justify-between h-full w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
						<div className="flex-1 flex items-center gap-2 overflow-hidden relative">
							<a
								href="/"
								className="flex flex-none items-center gap-2 overflow-hidden"
							>
								<img
									src={enterpriseStore.logo}
									title={enterpriseStore.display_name}
									className="max-w-[180px] max-h-8 rounded"
									alt={enterpriseStore.display_name}
								/>
							</a>
							<div className="flex-1 w-0 menu overflow-hidden">
								<Suspense fallback={<Skeleton.Input active size="small" />}>
									<Menu
										mode="horizontal"
										selectedKeys={[menuSelectedKey]}
										className="header-nav border-none bg-transparent"
										items={[
											...navigations.map((item) => ({
												key: item.menu_path,
												label: item.name,
												onClick: () => {
													// 外部链接或新窗口打开都走统一处理；其它才用 SPA 导航
													if (
														item.type === NAVIGATION_TYPE.EXTERNAL ||
														item.target === NAVIGATION_TARGET.BLANK
													) {
														handleNavigationClick(item);
													} else {
														navigate(item.jump_path);
													}
												},
											})),
											...(showMineMenu
												? [
														{
															key: "/mine",
															label: t("module.mine"),
															onClick: () => navigate("/mine"),
														},
													]
												: []),
										]}
									/>
								</Suspense>
							</div>
						</div>

						<div className="flex items-center gap-2">
							{userStore.is_login ? (
								<Suspense fallback={<Avatar size={26} />}>
									<ProfilePopover onProfile={handleProfile}>
										<div className="flex items-center gap-1.5 cursor-pointer max-md:hidden">
											<Avatar size={26} src={userStore.info.avatar} />
										</div>
									</ProfilePopover>
								</Suspense>
							) : (
								<Button type="primary" onClick={handleLogin}>
									{t("action.login")}
								</Button>
							)}
						</div>
					</div>
				</header>

				<main
					ref={mainRef}
					className="flex-1 relative overflow-y-auto flex flex-col"
				>
					{/* Banner */}
					{shouldShowBanner && (
						<Suspense fallback={null}>
							<Banner />
						</Suspense>
					)}
					<Outlet />
				</main>

				{/* Profile modal */}
				<Suspense fallback={null}>
					<ProfileModal
						open={showProfile}
						onClose={() => setShowProfile(false)}
					/>
				</Suspense>
			</div>
		);
	}

	// Software style layout (sidebar)
	const sidebarContextValue = {
		showSider,
		siderVisible,
		isMobile,
		handleToggle,
	};

	return (
		<SidebarContext.Provider value={sidebarContextValue}>
			<div className="h-full flex relative flex-row">
				{/* Hover trigger area */}
				{!useCompactMode && !showSider && !siderVisible && !isMobile && (
					<div
						className="w-4 h-full absolute -left-2 top-0 z-[10] hover:bg-gray-100/50 transition-colors"
						onMouseEnter={() => handleSiderVisibility(true)}
					/>
				)}

				{/* Mobile overlay */}
				{isMobile && siderVisible && (
					<div
						className="fixed top-0 left-0 w-full h-full z-[101] bg-black/60"
						onClick={handleToggle}
					/>
				)}

				{/* Sidebar */}
				<div
					ref={siderRef}
					className={`flex-none flex flex-col border-r bg-[#fff] transition-all duration-300 ease-linear overflow-hidden ${
						useCompactMode ? "w-[64px]" : "w-[240px]"
					} ${
						isMobile
							? "fixed top-0 bottom-0 z-[200]"
							: useCompactMode
								? "relative z-[10]"
								: "absolute top-0 bottom-0 left-0 z-[200]"
					} ${
						useCompactMode
							? ""
							: showSider
								? ""
								: siderVisible
									? "shadow-xl"
									: "-translate-x-full -ml-2"
					}`}
					onMouseLeave={() =>
						!useCompactMode && !isMobile && handleSiderVisibility(false)
					}
				>
					{useCompactMode ? (
						<div className="pt-4 pb-2 flex justify-center">
							<Tooltip title={enterpriseStore.display_name} placement="right">
								<img
									className="w-8 h-8 rounded"
									src={enterpriseStore.ico}
									alt={enterpriseStore.display_name}
								/>
							</Tooltip>
						</div>
					) : (
						<div className="px-3 py-4 flex items-center justify-between">
							<h1
								className="flex items-center gap-2 overflow-hidden"
								title={enterpriseStore.display_name}
							>
								<img
									className="max-w-[180px] max-h-8 rounded"
									src={enterpriseStore.logo}
									alt={enterpriseStore.display_name}
								/>
							</h1>
							<div
								className="size-6 flex-center cursor-pointer"
								onClick={handleToggle}
							>
								<SvgIcon name={showSider ? "left-bar" : "right-bar"} />
							</div>
						</div>
					)}

					<div
						className={`flex-1 overflow-y-auto flex flex-col justify-between ${useCompactMode ? "" : "px-3"}`}
					>
						<div>
							{/* Navigation menu */}
							<div
								className={`flex flex-col gap-1 py-3 ${useCompactMode ? "px-2" : ""}`}
							>
								{navigations.map((item) => {
									// 外部链接 - SELF：用 webview 路由（SPA 内 iframe 形式打开，避免整页刷新）
									if (
										item.type === NAVIGATION_TYPE.EXTERNAL &&
										item.target === NAVIGATION_TARGET.SELF
									) {
										return (
											<div
												key={item.navigation_id}
												role="button"
												onClick={() => {
													isMobile && setSiderVisible(false);
													handleNavigationClick(item);
												}}
												className={`py-2 rounded-lg flex flex-col items-center gap-1 cursor-pointer hover:bg-[#EBF1FF] ${getBlockColor(isNavItemActive(item))}`}
											>
												<div className={`size-5 flex-center overflow-hidden`}>
													<img
														className="w-5 h-5 -translate-y-16"
														src={item.icon}
														alt={item.name}
														style={{
															filter: `drop-shadow(${getIconColor(isNavItemActive(item))} 0 64px)`,
														}}
													/>
												</div>
												<p className="text-[10px] truncate">{item.name}</p>
											</div>
										);
									}

									// External link that opens in new tab (BLANK)
									if (item.type === NAVIGATION_TYPE.EXTERNAL) {
										return (
											<a
												key={item.navigation_id}
												href={item.jump_path}
												target="_blank"
												rel="noopener noreferrer"
												className={`py-2 rounded-lg flex flex-col items-center gap-1 cursor-pointer hover:bg-[#EBF1FF] ${getBlockColor(isNavItemActive(item))}`}
											>
												<div className={`size-5 flex-center overflow-hidden`}>
													<img
														className="w-5 h-5 -translate-y-16"
														src={item.icon}
														alt={item.name}
														style={{
															filter: `drop-shadow(${getIconColor(isNavItemActive(item))} 0 64px)`,
														}}
													/>
												</div>
												<p className="text-[10px] truncate">{item.name}</p>
											</a>
										);
									}

									// Router link
									return (
										<Link
											key={item.navigation_id}
											to={item.jump_path}
											target={
												item.target === NAVIGATION_TARGET.BLANK
													? "_blank"
													: "_self"
											}
											onClick={(e) => {
												isMobile && setSiderVisible(false);
												// 如果当前路径已经匹配，强制刷新页面状态
												if (activePath === item.jump_path) {
													e.preventDefault();
													// 触发路由重置事件
													window.dispatchEvent(
														new CustomEvent("reset-route-state", {
															detail: { path: item.jump_path },
														}),
													);
													navigate(item.jump_path, { replace: true });
												}
											}}
											className={`py-2 rounded-lg flex flex-col items-center gap-1 cursor-pointer hover:bg-[#EBF1FF] relative group ${getBlockColor(effectivePath.startsWith(item.menu_path))}`}
										>
											<div className={`size-5 flex-center overflow-hidden`}>
												<img
													className="w-5 h-5 -translate-y-16"
													src={item.icon}
													alt={item.name}
													style={{
														filter: `drop-shadow(${getIconColor(effectivePath.startsWith(item.menu_path))} 0 64px)`,
													}}
												/>
											</div>
											<p className="text-[10px] truncate">{item.name}</p>
										</Link>
									);
								})}

								{/* Recording menu */}
								{showRecordingMenu && (
									<Link
										to="/recording"
										onClick={() => {
											isMobile && setSiderVisible(false);
										}}
										className={`py-2 flex flex-col items-center gap-1 rounded-lg cursor-pointer hover:bg-[#EBF1FF] ${getBlockColor(effectivePath.startsWith("/recording"))}`}
									>
										<div className="size-5 flex-center">
											<SvgIcon name="voice-one" size="20" />
										</div>
										<p className="text-[10px] truncate">{t("module.recording")}</p>
									</Link>
								)}

								{/* Mine menu */}
								{showMineMenu && (
									<Link
										to="/mine"
										onClick={(e) => {
											isMobile && setSiderVisible(false);
										}}
										className={`py-2 flex flex-col items-center gap-1 rounded-lg cursor-pointer hover:bg-[#EBF1FF] ${getBlockColor(effectivePath.startsWith("/mine"))}`}
									>
										<div className={`size-5 flex-center`}>
											<SvgIcon name="member" size="18" />
										</div>
										<p className="text-[10px] truncate">{t("module.mine")}</p>
									</Link>
								)}
							</div>
						</div>

						{/* Shortcuts */}
						{shortcutsStore.shortcuts.length > 0 && (
							<div className="py-3 flex flex-col gap-1">
								{!useCompactMode && (
									<div className="h-7 px-2 flex items-center text-sm text-[#9A9A9A]">
										{t("shortcut.title")}
									</div>
								)}
								{shortcutsStore.shortcuts.map((shortcut) => (
									<Tooltip
										key={shortcut.id}
										title={useCompactMode ? shortcut.name : ""}
										placement="right"
										getPopupContainer={() => document.body}
									>
										<div
											className={`h-9 flex items-center gap-2 rounded cursor-pointer hover:bg-[#EBF1FF] group ${useCompactMode ? "px-2 justify-center mx-2" : "px-2"}`}
											onClick={() => handleShortcutClick(shortcut)}
										>
											<img
												src={shortcut.logo}
												className="size-5 rounded flex-center"
												alt={shortcut.name}
											/>
											{!useCompactMode && (
												<>
													<p className="flex-1 text-sm text-[#1D1E1F] truncate">
														{shortcut.name}
													</p>
													<MoreDropdown
														size="20px"
														icon="more-h"
														iconSize={16}
														backgroundColor="#EDEEF0"
														triggerClassName="size-5 items-center justify-center group-hover:flex hidden"
														placement="bottomLeft"
														items={[
															{
																key: "new-tab",
																icon: "arrow-right-up",
																label: t("action.tab_open"),
															},
															{
																key: "remove",
																icon: "delete-mode",
																label: t("shortcut.remove"),
															},
														]}
														onCommand={(key) =>
															handleShortcutCommand(key as string, shortcut)
														}
													/>
												</>
											)}
										</div>
									</Tooltip>
								))}
							</div>
						)}
					</div>

					{/* User section */}
					<div
						className={`flex-none flex items-center gap-1 relative ${useCompactMode ? "p-2 flex-col" : "p-4"}`}
					>
						<div className="absolute top-0 left-2 right-2" />

						{userStore.is_login ? (
							<>
								<Suspense fallback={<Avatar size={useCompactMode ? 32 : 34} />}>
									<ProfilePopover
										placement={useCompactMode ? "rightTop" : "bottomLeft"}
										onProfile={handleProfile}
										unreadCount={unreadCount}
										showMessageCenter={useCompactMode && hasKnowledge}
									>
										<Tooltip
											title=""
											placement="right"
											getPopupContainer={() => document.body}
										>
											<div
												className={`flex overflow-hidden items-center cursor-pointer ${useCompactMode ? "flex-col gap-1" : "flex-1  gap-2"}`}
											>
												<div className={useCompactMode ? "relative" : ""}>
													{/* 紧凑模式下在头像右上角显示红点 */}
													<Badge
														dot={
															useCompactMode && unreadCount > 0 && hasKnowledge
														}
													>
														<Avatar
															size={useCompactMode ? 32 : 34}
															src={userStore.info.avatar}
															className="border border-white"
														/>
													</Badge>
												</div>
												{useCompactMode ? (
													<div className="text-xs text-[#1D1E1F] truncate max-w-[50px] text-center">
														{userStore.info.nickname || userStore.info.username}
													</div>
												) : (
													<div className="flex-1 overflow-hidden">
														<div className="text-sm font-medium text-[#1D1E1F] truncate">
															{userStore.info.nickname ||
																userStore.info.username}
														</div>
														<div className="text-xs text-[#999999] truncate">
															{enterpriseStore.display_name}
														</div>
													</div>
												)}
											</div>
										</Tooltip>
									</ProfilePopover>
								</Suspense>
							</>
						) : (
							<Tooltip
								title={useCompactMode ? t("action.login") : ""}
								placement="right"
								getPopupContainer={() => document.body}
							>
								<Avatar
									size={useCompactMode ? 32 : 34}
									icon={<UserOutlined />}
									className="cursor-pointer"
									onClick={handleLogin}
								/>
							</Tooltip>
						)}

						{/* Message Center - 只在非紧凑模式下显示 */}
						{!useCompactMode &&
							userStore.is_login &&
							hasKnowledge &&
							messageCenterReady && (
								<Suspense fallback={null}>
									<MessageCenter />
								</Suspense>
							)}
					</div>
				</div>

				{/* Main content */}
				<main
					ref={mainRef}
					className="flex-1 relative overflow-y-auto flex flex-col transition-all duration-300"
					style={{
						marginLeft: useCompactMode ? "0" : showSider ? "240px" : "0",
					}}
				>
					{navigations.length === 0 && !showMineMenu ? null : <Outlet />}
				</main>

				{/* Profile modal */}
				<Suspense fallback={null}>
					<ProfileModal
						open={showProfile}
						onClose={() => setShowProfile(false)}
					/>
				</Suspense>

				{/* Portal: Expand sidebar button - teleported to .header-before-prefix in page header */}
				{!showSider &&
					teleportReady &&
					(() => {
						const target = document.querySelector(".header-before-prefix");
						return target
							? createPortal(
									<Tooltip title={t("chat.expand_side_bar")}>
										<div
											className="flex-none size-7 rounded-md flex-center cursor-pointer hover:bg-[#ECEDEE]"
											onClick={handleToggle}
										>
											<SvgIcon name="layout-left" size="20" color="#9A9A9A" />
										</div>
									</Tooltip>,
									target,
								)
							: null;
					})()}

				{/* Recording Float - global recording status indicator */}
				<Suspense fallback={null}>
					<RecordingFloat />
				</Suspense>
			</div>
		</SidebarContext.Provider>
	);
}
