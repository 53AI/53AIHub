import {
	ChatConfigProvider,
	ChatMessages,
	createSourceClickHandler,
	createSourceReferenceHandler,
	type KnowledgePanelData,
	loadMessages,
	type SourceReferenceData,
	SourceReferenceManager,
	type SourceReferenceManagerRef,
	useRagStats,
} from "@km/shared-business";
import { Button, Drawer, message, Tooltip } from "antd";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import chunksApi from "@/api/modules/chunks";
import { SEARCH_TYPE } from "@/api/modules/feedback/types";
import { AddAnswerAsMd, type AddAnswerAsMdRef } from "@km/shared-business";
import { markdownPreview } from "@/components/Markdown/helper";
import { useEnv } from "@/hooks/useEnv";
import { t } from "@/locales";
import { useLocaleStore } from "@/stores/modules/locale";
import { addAnswerAsMdApi } from "./addAnswerAsMdAdapter";
import { SvgIcon } from "@km/shared-components-react";

export interface DetailRef {
	open: (params: { index: number; tableData: any[]; type: string }) => void;
}

export interface DetailProps {
	/**
	 * 问答明细：按 message id 加载**会话内**上一条/下一条（每次只取 1 条）。
	 * 传入后抽屉改用消息区上/下内联加载按钮驱动，不再依赖列表分页数据。
	 */
	loadNeighborRecord?: (record: any, direction: "prev" | "next") => Promise<any | null>;
}

const Detail = forwardRef<DetailRef, DetailProps>((props, ref) => {
	const { loadNeighborRecord } = props;
	const [visible, setVisible] = useState(false);
	const [title, setTitle] = useState("");
	const [curIndex, setCurIndex] = useState<number>(0);
	const [curType, setCurType] = useState<string>("");
	const [list, setList] = useState<any[]>([]);
	// 问答明细：当前展示的消息记录（翻页时整体替换）
	const [curRecord, setCurRecord] = useState<any>(null);
	// 会话内相邻消息是否已到底（加载返回空后置位，避免重复请求）
	const [prevExhausted, setPrevExhausted] = useState(false);
	const [nextExhausted, setNextExhausted] = useState(false);
	const [neighborLoading, setNeighborLoading] = useState<"prev" | "next" | null>(null);
	const locale = useLocaleStore((state) => state.locale);
	const { buildFrontLibraryFileUrl, buildFrontLibraryUrl, buildFrontWikiUrl, getFrontBaseUrl } = useEnv();
	const { formatRagStats } = useRagStats();

	// 源引用管理器 ref
	const sourceRefManagerRef = useRef<SourceReferenceManagerRef>(null);

	// 消息区域容器 ref：切换记录后手动把内容拉回顶部
	const messagesBoxRef = useRef<HTMLDivElement>(null);

	// 滚动翻页运行时状态镜像：事件监听里读 ref，避免闭包拿到旧的边界值
	const scrollPagingRef = useRef({
		prevExhausted: false,
		nextExhausted: false,
		cooldown: false,
		load: (_direction: "prev" | "next") => {},
	});
	// 请求互斥：按钮 / 滚动 / 键盘多个入口共用，neighborLoading 只负责 UI 状态
	const inFlightRef = useRef(false);

	// 「添加到」弹窗 ref：把回答保存为 Markdown 文件到知识库
	const addAnswerAsMdRef = useRef<AddAnswerAsMdRef>(null);

	// 消息菜单「添加到」回调：与前台 ChatContainer 同款取值逻辑
	const handleAddAsMd = useCallback((msg: any) => {
		const answer = msg?.answer?.trim() || "";
		if (!answer) return;
		addAnswerAsMdRef.current?.open({
			answer,
			question:
				msg?.question?.trim() ||
				msg?.original_question?.trim() ||
				t("search-record.question"),
		});
	}, []);

	// 获取 chunk 详情回调
	const fetchChunkDetail = useCallback(async (chunkId: string) => {
		const res = await chunksApi.get(chunkId);
		return {
			content: res?.content || "",
			token_count: res?.token_count || 0,
			chunk_index: res?.chunk_index || 0,
		};
	}, []);

	// Markdown 渲染回调
	const handleRenderMarkdown = useCallback(
		async (element: HTMLDivElement, content: string) => {
			await markdownPreview(element, content);
		},
		[],
	);

	// 未找到 chunk 时的回调
	const handleChunkNotFound = useCallback((data: SourceReferenceData) => {
		message.info(t("search.view_reference", { sourceType: data.sourceType, sourceNumber: data.sourceNumber }));
	}, []);

	// 后台场景：知识面板点击跳转前台
	const handleOpenKnowledgePanel = useCallback(
		(data: KnowledgePanelData) => {
				let sourceUrl = ''
			// scope_narrowing: 点击知识库名称跳转知识库首页
			if (data.type === "scope_narrowing" && data.source?.library_id) {
				sourceUrl = buildFrontLibraryUrl(data.source.library_id);
			}
			// source_click: 点击单个源文件
			if (data.type === "source_click" && data.source) {
				const source = data.source;
				if (source.chunk_type === 'wiki') {
					sourceUrl = buildFrontWikiUrl(source.space_id, source.slug)
				}
				if (source.library_id && source.file_id) {
					sourceUrl = buildFrontLibraryFileUrl(
						source.library_id,
						source.file_id,
					);
				}
			}
			// knowledge_search: 点击知识检索结果
			if (
				data.type === "knowledge_search" &&
				data.files &&
				data.files.length > 0
			) {
				const firstFile = data.files[0];
				if (firstFile.library_id && firstFile.file_id) {
					sourceUrl = buildFrontLibraryFileUrl(
						firstFile.library_id,
						firstFile.file_id,
					);
				}
			}
			if (sourceUrl) {
				window.open(sourceUrl, "_blank", "noopener,noreferrer");
				return true;
			}
			return false;
		},
		[buildFrontLibraryFileUrl, buildFrontLibraryUrl, buildFrontWikiUrl],
	);

	const [feedbackInfo, setFeedbackInfo] = useState([
		{ label: t("search-feedback.user"), value: "---" },
		{ label: t("search-feedback.time"), value: "---" },
		{ label: t("search-feedback.feedback_type"), value: "---" },
		{ label: t("search-feedback.question_type"), value: "---" },
		{ label: t("search-feedback.description"), value: "---" },
	]);

	const [recordInfo, setRecordInfo] = useState([
		{ label: t("search-record.user"), value: "---" },
		{ label: t("search-record.time"), value: "---" },
		{ label: t("search-record.rewrite"), value: "---" },
	]);

	const [messageList, setMessageList] = useState<any[]>([]);

	const info = useMemo(() => {
		return curType === SEARCH_TYPE.FEEDBACK ? feedbackInfo : recordInfo;
	}, [curType, feedbackInfo, recordInfo]);

	const loadMessage = async (row: any, type: string) => {
		if (!row) return;

		if (type === SEARCH_TYPE.FEEDBACK) {
			setTitle(row.original_question || "");
			setFeedbackInfo([
				{ label: t("search-feedback.user"), value: row.nickname || "---" },
				{ label: t("search-feedback.time"), value: row.updated_time || "---" },
				{
					label: t("search-feedback.feedback_type"),
					value:
						row.feedback_type === "satisfied"
							? t("search-feedback.satisfied")
							: row.feedback_type === "unsatisfied"
								? t("search-feedback.unsatisfied")
								: "---",
				},
				{
					label: t("search-feedback.question_type"),
					value: row.reason || "---",
				},
				{
					label: t("search-feedback.description"),
					value: row.description || "---",
				},
			]);
			const { messages } = await loadMessages([row.message_info], 1, {
				formatRagStats,
			});
			setMessageList(messages);
		} else if (type === SEARCH_TYPE.RECORD) {
			setTitle(row.original_question || "");
			setRecordInfo([
				{ label: t("search-record.user"), value: row.nickname || "---" },
				{ label: t("search-record.time"), value: row.updated_time || "---" },
				{
					label: t("search-record.rewrite"),
					value: row.rewritten_question || "---",
				},
			]);
			const { messages } = await loadMessages([row], 1, {
				formatRagStats,
			});
			setMessageList(messages);
		}
	};

	useImperativeHandle(ref, () => ({
		open: ({ index, tableData, type }) => {
			setCurIndex(index);
			setList(tableData);
			setCurType(type);
			const row = tableData[index];
			setCurRecord(row ?? null);
			setPrevExhausted(false);
			setNextExhausted(false);
			loadMessage(row, type);
			setVisible(true);
		},
	}));

	// footer 上一条/下一条：问答明细列表（页内）切换
	const handleToPrev = () => {
		const nextIndex = curIndex - 1;
		if (nextIndex >= 0) {
			setCurIndex(nextIndex);
			const row = list[nextIndex];
			setCurRecord(row ?? null);
			setPrevExhausted(false);
			setNextExhausted(false);
			loadMessage(row, curType);
		}
	};

	const handleToNext = () => {
		const nextIndex = curIndex + 1;
		if (nextIndex < list.length) {
			setCurIndex(nextIndex);
			const row = list[nextIndex];
			setCurRecord(row ?? null);
			setPrevExhausted(false);
			setNextExhausted(false);
			loadMessage(row, curType);
		}
	};

	// 会话内按 message id 加载上一条/下一条（每次只拉 1 条）
	const handleLoadNeighbor = async (direction: "prev" | "next") => {
		if (!loadNeighborRecord || !curRecord) return;
		// 按钮 / 滚动 / 键盘多个入口可能同时到达，请求期间直接忽略
		if (inFlightRef.current) return;
		inFlightRef.current = true;
		setNeighborLoading(direction);
		try {
			const neighbor = await loadNeighborRecord(curRecord, direction);
			if (!neighbor) {
				// 到边界：置位后由消息区顶部/底部的弱提示反馈，不再弹 toast 打扰
				if (direction === "prev") setPrevExhausted(true);
				else setNextExhausted(true);
				return;
			}
			setPrevExhausted(false);
			setNextExhausted(false);
			setCurRecord(neighbor);
			await loadMessage(neighbor, SEARCH_TYPE.RECORD);
		} catch (error) {
			console.error("load neighbor record failed", error);
			message.error(t("search-record.load_failed"));
		} finally {
			inFlightRef.current = false;
			setNeighborLoading(null);
		}
	};

	// 是否使用会话内游标翻页（仅问答明细且调用方提供了加载方法）
	const useNeighborPaging =
		curType === SEARCH_TYPE.RECORD && typeof loadNeighborRecord === "function";

	// 同步滚动/键盘翻页所需的运行时状态（渲染期不写 ref，统一在这里刷新）
	useEffect(() => {
		scrollPagingRef.current.prevExhausted = prevExhausted;
		scrollPagingRef.current.nextExhausted = nextExhausted;
		scrollPagingRef.current.load = handleLoadNeighbor;
	});

	// 切换消息后回到内容顶部：ChatMessages 在 autoScroll=false 下不再自动滚到底部，
	// 由这里显式把滚动容器归零，否则用户看到的还是上一条消息的滚动位置。
	// 归零会触发一次 scroll 事件，用 cooldown 防止被当成「用户滚到顶部」而自动加载上一轮。
	useEffect(() => {
		if (!useNeighborPaging || !visible) return;
		const frame = requestAnimationFrame(() => {
			const wrapper =
				messagesBoxRef.current?.querySelector<HTMLDivElement>(".bubble-wrapper");
			if (!wrapper) return;
			scrollPagingRef.current.cooldown = true;
			wrapper.scrollTop = 0;
			window.setTimeout(() => {
				scrollPagingRef.current.cooldown = false;
			}, 400);
		});
		return () => cancelAnimationFrame(frame);
	}, [curRecord, useNeighborPaging, visible]);

	// 滚到顶部/底部「后再滚一次」才翻页：避免读完内容滚到底就被换掉，
	// 也避免回到顶部重读开头时误触上一轮。无滚动空间时不做处理，交给上下按钮。
	// 用容器做事件代理（scroll/wheel 不冒泡，故用 capture），不依赖挂载时抓到的节点。
	useEffect(() => {
		if (!useNeighborPaging || !visible) return;

		const handleEdgeWheel = (event: WheelEvent) => {
			const runtime = scrollPagingRef.current;
			if (runtime.cooldown || inFlightRef.current) return;
			const container = messagesBoxRef.current;
			const target = event.target as HTMLElement | null;
			if (!container || !target || !container.contains(target)) return;
			if (!target.classList?.contains("bubble-wrapper")) return;
			const { scrollTop, scrollHeight, clientHeight } = target;
			// 内容不足以产生滚动条时没有「越界滚动」语义
			if (scrollHeight - clientHeight <= 24) return;
			const atTop = scrollTop <= 0;
			const atBottom = scrollHeight - scrollTop - clientHeight <= 8;
			if (atTop && event.deltaY < 0 && !runtime.prevExhausted) {
				runtime.load("prev");
				return;
			}
			if (atBottom && event.deltaY > 0 && !runtime.nextExhausted) {
				runtime.load("next");
			}
		};

		// 挂到 window 并做包含判断：抽屉内容异步挂载，容器节点晚于本 effect 就绪
		window.addEventListener("wheel", handleEdgeWheel, {
			passive: true,
			capture: true,
		});
		return () => {
			window.removeEventListener("wheel", handleEdgeWheel, {
				capture: true,
			} as EventListenerOptions);
		};
	}, [useNeighborPaging, visible]);

	// 键盘翻页：J / → 下一轮，K / ← 上一轮（逐条核查比鼠标按钮更快，且不会误触）
	useEffect(() => {
		if (!useNeighborPaging || !visible) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable ||
					/^(input|textarea|select)$/i.test(target.tagName))
			) {
				return;
			}
			const runtime = scrollPagingRef.current;
			if (inFlightRef.current) return;
			const key = event.key.toLowerCase();
			if (key === "j" || event.key === "ArrowRight") {
				event.preventDefault();
				if (!runtime.nextExhausted) runtime.load("next");
				return;
			}
			if (key === "k" || event.key === "ArrowLeft") {
				event.preventDefault();
				if (!runtime.prevExhausted) runtime.load("prev");
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [useNeighborPaging, visible]);

	const closeDrawer = () => {
		setVisible(false);
	};

	const drawerTitle = (
		<div className="w-full text-2xl flex items-center">
			<div className="w-[10%] min-w-fit mr-2">
				{t("search-record.question")}：
			</div>
			<Tooltip title={title}>
				<div className="flex-1 truncate font-normal">{title}</div>
			</Tooltip>
		</div>
	);

	return (
		<Drawer
			title={drawerTitle}
			onClose={closeDrawer}
			open={visible}
			styles={{ wrapper: { width: 890 } }}
			footer={
				<div className="flex justify-end gap-2">
					<Button disabled={curIndex === 0} onClick={handleToPrev}>
						{t("search-feedback.prev")}
					</Button>
					<Button
						disabled={curIndex === list.length - 1}
						type="primary"
						onClick={handleToNext}
					>
						{t("search-feedback.next")}
					</Button>
				</div>
			}
		>
			<div className="flex flex-wrap gap-2 mb-7">
				{info.map((item) => (
					<div key={item.label} className="flex w-[270px] text-sm mb-2">
						<span className="w-[60px] text-gray-400 mr-3 shrink-0">
							{item.label}
						</span>
						<Tooltip title={item.value}>
							<div className="max-w-[198px] truncate">{item.value}</div>
						</Tooltip>
					</div>
				))}
			</div>

			<div className="text-base font-medium mb-5">
				{t("search-feedback.search-detail")}
			</div>

			<div
				ref={messagesBoxRef}
				className="border border-gray-200 rounded-xl py-4 flex flex-col h-[calc(100%-150px)] overflow-hidden"
			>
				{useNeighborPaging && (
					<div className="flex flex-col items-center">
						<Button
							type="link"
							className="flex-col gap-0"
							loading={neighborLoading === "prev"}
							disabled={neighborLoading !== null || prevExhausted}
							onClick={() => handleLoadNeighbor("prev")}
						>
							<div>
								<SvgIcon name="double-up" size="12" />
							</div>
							{t("search-record.prev_turn")}
						</Button>
						{prevExhausted && (
							<span className="text-xs text-placeholder">
								{t("search-record.no_prev")}
							</span>
						)}
					</div>
				)}
				<ChatConfigProvider
					lang={locale}
					frontUrl={getFrontBaseUrl()}
					buildLibraryUrl={buildFrontLibraryFileUrl}
					onOpenKnowledgePanel={handleOpenKnowledgePanel}
				>
					<ChatMessages
						messageList={messageList}
						agentInfo={{}}
						isStreaming={false}
						autoScroll={!useNeighborPaging}
						features={{
							menu: {
								copy: true,
								feedback: false,
								regenerate: false,
								share: false,
								addAsMd: true,
							},
						}}
						messageAction={{
							onAddAsMd: handleAddAsMd,
						}}
						slots={{
							source: ({ type, number }: { type: string; number: number }) => {
								if (type === "web")
									return `${t("source.chunk_title")}-${number}`;
								return `${type}-${number}`;
							},
						}}
						sourceAction={{
							onClick: useMemo(
								() => createSourceClickHandler(sourceRefManagerRef),
								[],
							),
							onReferenceClick: useMemo(
								() => createSourceReferenceHandler(sourceRefManagerRef),
								[],
							),
						}}
					/>
					{/* 源引用管理器（包含 Chunk 和 Graph 弹窗） */}
					<SourceReferenceManager
						ref={sourceRefManagerRef}
						fetchChunkDetail={fetchChunkDetail}
						renderMarkdown={handleRenderMarkdown}
						onChunkNotFound={handleChunkNotFound}
					/>
					{/* 「添加到」弹窗：把回答保存为 Markdown 文件到知识库 */}
					<AddAnswerAsMd
						ref={addAnswerAsMdRef}
						api={addAnswerAsMdApi}
						buildFileUrl={buildFrontLibraryFileUrl}
					/>
				</ChatConfigProvider>
				{useNeighborPaging && (
					<div className="flex flex-col items-center">
						<Button
							type="link"
							className="flex-col gap-0"
							loading={neighborLoading === "next"}
							disabled={neighborLoading !== null || nextExhausted}
							onClick={() => handleLoadNeighbor("next")}
						>
							{t("search-record.next_turn")}
							<div>
								<SvgIcon name="double-down" size="12" />
							</div>
						</Button>
						{nextExhausted && (
							<span className="text-xs text-placeholder">
								{t("search-record.no_next")}
							</span>
						)}
					</div>
				)}
			</div>
		</Drawer>
	);
});

Detail.displayName = "Detail";

export default Detail;
