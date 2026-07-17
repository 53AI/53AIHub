import {
	ChatConfigProvider,
	ChatMessages,
	createSourceClickHandler,
	createSourceReferenceHandler,
	type KnowledgePanelData,
	type SourceReferenceData,
	SourceReferenceManager,
	type SourceReferenceManagerRef,
} from "@km/shared-business";
import { Button, Drawer, message, Tooltip } from "antd";
import {
	forwardRef,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import chunksApi from "@/api/modules/chunks";
import { getMessageList } from "@/api/modules/feedback/transform";
import { SEARCH_TYPE } from "@/api/modules/feedback/types";
import { markdownPreview } from "@/components/Markdown/helper";
import { useEnv } from "@/hooks/useEnv";
import { t } from "@/locales";
import { useLocaleStore } from "@/stores/modules/locale";

export interface DetailRef {
	open: (params: { index: number; tableData: any[]; type: string }) => void;
}

const Detail = forwardRef<DetailRef>((props, ref) => {
	const [visible, setVisible] = useState(false);
	const [title, setTitle] = useState("");
	const [curIndex, setCurIndex] = useState<number>(0);
	const [curType, setCurType] = useState<string>("");
	const [list, setList] = useState<any[]>([]);
	const locale = useLocaleStore((state) => state.locale);
	const { buildFrontLibraryFileUrl, buildFrontLibraryUrl } = useEnv();

	// 源引用管理器 ref
	const sourceRefManagerRef = useRef<SourceReferenceManagerRef>(null);

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
		message.info(`查看引用: ${data.sourceType}-${data.sourceNumber}`);
	}, []);

	// 后台场景：知识面板点击跳转前台
	const handleOpenKnowledgePanel = useCallback(
		(data: KnowledgePanelData) => {
			// scope_narrowing: 点击知识库名称跳转知识库首页
			if (data.type === "scope_narrowing" && data.source?.library_id) {
				const url = buildFrontLibraryUrl(data.source.library_id);
				window.open(url, "_blank", "noopener,noreferrer");
				return true;
			}
			// source_click: 点击单个源文件
			if (data.type === "source_click" && data.source) {
				const source = data.source;
				if (source.library_id && source.file_id) {
					const url = buildFrontLibraryFileUrl(
						source.library_id,
						source.file_id,
					);
					window.open(url, "_blank", "noopener,noreferrer");
					return true;
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
					const url = buildFrontLibraryFileUrl(
						firstFile.library_id,
						firstFile.file_id,
					);
					window.open(url, "_blank", "noopener,noreferrer");
					return true;
				}
			}
			return false;
		},
		[buildFrontLibraryFileUrl, buildFrontLibraryUrl],
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

	const loadMessage = (index: number, type: string, tableData: any[]) => {
		const row = tableData[index];
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
			setMessageList(getMessageList(row.message_info, row.original_question));
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
			setMessageList(getMessageList(row, row.original_question));
		}
	};

	useImperativeHandle(ref, () => ({
		open: ({ index, tableData, type }) => {
			setCurIndex(index);
			setList(tableData);
			setCurType(type);
			loadMessage(index, type, tableData);
			setVisible(true);
		},
	}));

	const handleToPrev = () => {
		const nextIndex = curIndex - 1;
		if (nextIndex >= 0) {
			setCurIndex(nextIndex);
			loadMessage(nextIndex, curType, list);
		}
	};

	const handleToNext = () => {
		const nextIndex = curIndex + 1;
		if (nextIndex < list.length) {
			setCurIndex(nextIndex);
			loadMessage(nextIndex, curType, list);
		}
	};

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

			<div className="border border-gray-200 rounded-xl py-4 flex flex-col h-[calc(100%-150px)]">
				<ChatConfigProvider
					lang={locale}
					buildLibraryUrl={buildFrontLibraryFileUrl}
					onOpenKnowledgePanel={handleOpenKnowledgePanel}
				>
					<ChatMessages
						messageList={messageList}
						agentInfo={{}}
						isStreaming={false}
						features={{
							menu: {
								copy: true,
								feedback: false,
								regenerate: false,
								share: false,
								addAsMd: false,
							},
							outputFiles: true,
							sourceRef: true,
							processFlow: true,
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
				</ChatConfigProvider>
			</div>
		</Drawer>
	);
});

Detail.displayName = "Detail";

export default Detail;
