import { useState, useCallback, forwardRef, useImperativeHandle, useRef } from "react";
import { Button, Input, Tag, Spin, message, Space } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { MarkdownEditor, type MarkdownEditorRef } from "@/components/Markdown/editor";
import { EditorSection } from "./editor-section";
import { t } from "@/locales";
import chunksApi, {
  type KnowledgeChunk,
  type RetrievalChunk,
  type KnowledgeChunkRequestData,
} from "@/api/modules/chunks";
import {
  CHUNK_TYPE,
  AI_GENERATE_CHUNK_STATUS,
  EMBEDDING_STATUS,
} from "@/constants/chunk";
import { useLibraryStore, type FileItem } from "@/stores/modules/library";
import { usePoll } from "@/hooks/usePoll";
import {
  getRetrievalChunkStatusMeta,
  isRetrievalChunkEmbeddingInProgress,
} from "./retrieval-status";

const { TextArea } = Input;

interface SimpleChunk {
  id: number;
  content: string;
}

interface EditDrawerProps {
  file: FileItem;
  onSuccess?: (data: KnowledgeChunkRequestData) => void;
}

export interface EditDrawerRef {
  open: (chunk: KnowledgeChunk, file?: FileItem) => void;
}

const defaultKnowledge: KnowledgeChunk = {
  id: 0,
  eid: 0,
  file_id: "",
  library_id: "",
  content: "",
  content_hash: "",
  chunk_index: 0,
  chunk_type: "",
  start_position: 0,
  end_position: 0,
  token_count: 0,
  status: "",
  is_manual_edited: false,
  embedding_status: "",
  vector_id: "",
  created_time: 0,
  updated_time: 0,
  ai_generate_doc_chunk_status: "",
};

const numberToIndex = (num: number): string => {
  return String(num +1).padStart(2, "0")
};

export const EditDrawer = forwardRef<EditDrawerRef, EditDrawerProps>(
  ({ file, onSuccess }, ref) => {
    const libraryStore = useLibraryStore();

    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [curChunk, setCurChunk] = useState<KnowledgeChunk | null>(null);
    const [drawerFile, setDrawerFile] = useState<FileItem | null>(null);

    const [knowledge, setKnowledge] = useState<KnowledgeChunk>({
      ...defaultKnowledge,
    });
    const [retrievalChunks, setRetrievalChunks] = useState<RetrievalChunk[]>(
      [],
    );
    const [retryingRetrievalChunkId, setRetryingRetrievalChunkId] =
      useState<number | null>(null);
    const [commonQuestions, setCommonQuestions] = useState<SimpleChunk[]>([]);
    const [summary, setSummary] = useState<SimpleChunk[]>([]);

    // Use refs to always get latest values in callbacks
    const curChunkRef = useRef<KnowledgeChunk | null>(null);
    const currentFileRef = useRef<FileItem | undefined>(undefined);
    const editorRef = useRef<MarkdownEditorRef>(null);

    const currentFile = libraryStore.currentFile();
    // Update refs when values change
    currentFileRef.current = currentFile;

    const loadChunkDetail = useCallback(
      async (chunk: KnowledgeChunk): Promise<RetrievalChunk[] | null> => {
        setLoading(true);
        try {
          const res = await chunksApi.retrieval.get(chunk.id);
          const defaultRetrievalChunks = res.retrieval_chunks.filter(
            (item) => item.chunk_type === CHUNK_TYPE.RETRIEVAL,
          );
          setKnowledge(res.knowledge_chunk);
          setRetrievalChunks(defaultRetrievalChunks);
          setSummary(
            res.retrieval_chunks.filter(
              (item) => item.chunk_type === CHUNK_TYPE.SUMMARY,
            ),
          );
          setCommonQuestions(
            res.retrieval_chunks.filter(
              (item) => item.chunk_type === CHUNK_TYPE.QUESTION,
            ),
          );
          return defaultRetrievalChunks;
        } catch (error) {
          console.error(error);
          return null;
        } finally {
          setLoading(false);
        }
      },
      [],
    );

    const { start: startPoll, stop: stopPoll } = usePoll(async () => {
      const file = currentFileRef.current;
      if (!file?.id) return;
      await libraryStore.loadFile(file.id, true);
      const updatedFile = currentFileRef.current;
      const isAIGenerating = [
        AI_GENERATE_CHUNK_STATUS.PENDING,
        AI_GENERATE_CHUNK_STATUS.PARSING,
      ].includes(updatedFile?.ai_generate_chunk_status || "");
      const loadedRetrievalChunks = curChunkRef.current
        ? await loadChunkDetail(curChunkRef.current)
        : [];
      const isEmbedding =
        loadedRetrievalChunks === null ||
        loadedRetrievalChunks.some((item) =>
          isRetrievalChunkEmbeddingInProgress(item.embedding_status),
        );

      if (!isAIGenerating && !isEmbedding) {
        stopPoll();
      }
    });

    const handleRetryEmbedding = useCallback(
      async (retrievalChunk: RetrievalChunk) => {
        if (retryingRetrievalChunkId !== null) return;

        setRetryingRetrievalChunkId(retrievalChunk.id);
        try {
          await chunksApi.retrieval.reindex(retrievalChunk.id);
          setRetrievalChunks((prev) =>
            prev.map((item) =>
              item.id === retrievalChunk.id
                ? {
                    ...item,
                    embedding_status: EMBEDDING_STATUS.PENDING,
                    error_reason: "",
                  }
                : item,
            ),
          );
          message.success("已重新加入索引队列");
          startPoll();
        } catch (error) {
          console.error(error);
          message.error("重新索引失败，请稍后重试");
        } finally {
          setRetryingRetrievalChunkId(null);
        }
      },
      [retryingRetrievalChunkId, startPoll],
    );

    const handleAddSummary = useCallback(() => {
      setSummary((prev) => [...prev, { id: Date.now(), content: "" }]);
    }, []);

    const handleDelSummary = useCallback((index: number) => {
      setSummary((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleAddCommonQuestion = useCallback(() => {
      setCommonQuestions((prev) => [...prev, { id: Date.now(), content: "" }]);
    }, []);

    const handleDelCommonQuestion = useCallback((index: number) => {
      setCommonQuestions((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleCancel = useCallback(() => {
      setKnowledge({ ...defaultKnowledge });
      setRetrievalChunks([]);
      setRetryingRetrievalChunkId(null);
      setCommonQuestions([]);
      setSummary([]);
      setVisible(false);
    }, []);

    const handleSave = useCallback(async () => {
      setSaving(true);
      try {
        // Get the latest content directly from vditor to avoid timing issues
        const content = editorRef.current?.getValue() ?? knowledge.content;
        const data: KnowledgeChunkRequestData = {
          file_id: knowledge.file_id,
          library_id: knowledge.library_id,
          chunk_id: knowledge.id,
          content,
          common_questions: commonQuestions.map((item) => item.content),
          summary: summary.map((item) => item.content),
          related_knowledge_ids: [],
        };
        await chunksApi.knowledge.save(data);
        message.success(t("status.save_success"));
        onSuccess?.(data);
        handleCancel();
      } catch (error) {
        console.error(error);
      } finally {
        setSaving(false);
      }
    }, [knowledge, commonQuestions, summary, onSuccess, handleCancel, t]);

    useImperativeHandle(
      ref,
      () => ({
        open: (chunk: KnowledgeChunk, file?: FileItem) => {
          curChunkRef.current = chunk;
          setCurChunk(chunk);
          if (file) {
            setDrawerFile(file);
          }
          const currentFile = currentFileRef.current;
          if (currentFile?.id) {
            startPoll();
          }
          loadChunkDetail(chunk);
          setVisible(true);
        },
      }),
      [startPoll, loadChunkDetail],
    );

    if (!visible) return null;

    return (
      <div className="fixed inset-0 z-50 flex chunk-edit-drawer">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30" />

        {/* Panel */}
        <div className="relative ml-auto h-full w-full bg-white flex flex-col">
          {/* Title */}
          <div className="flex-none h-14 border-b flex items-center justify-center gap-1">
            <div className="text-sm text-[#1D1E1F]">
              {drawerFile?.name || file?.name}
            </div>
            <Tag>#{numberToIndex(knowledge.chunk_index)}</Tag>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            <Spin
              spinning={loading}
              classNames={{
                root: "h-full",
                container: "h-full",
              }}
            >
              <div className="h-full flex overflow-hidden">
                {/* Left Panel - Knowledge */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="border-b flex px-5">
                    <h5 className="h-14 flex items-center text-base text-[#2563EB] border-b-2 border-[#2563EB]">
                      {t("chunk.knowledge")}
                    </h5>
                  </div>
                  <div className="flex-1 px-5 py-5 overflow-hidden">
                    {/* 直接挂载编辑器：抽屉关闭时整个 DOM 卸载，重开时编辑器以正确尺寸初始化 */}
                    <MarkdownEditor
                      ref={editorRef}
                      key={knowledge.id}
                      value={knowledge.content}
                      onChange={(value) =>
                        setKnowledge((prev) => ({ ...prev, content: value }))
                      }
                      height="100%"
                      className="border rounded"
                    />
                  </div>
                </div>

            {/* Right Panel - Retrieval */}
            <div className="flex-1 border-l flex flex-col">
              <div className="flex-none border-b flex px-5 overflow-y-auto">
                <h5 className="h-14 flex items-center text-base text-[#2563EB] border-b-2 border-[#2563EB]">
                  {t("chunk.retrieval")}
                </h5>
              </div>
              <div className="flex-1 px-5 my-5 overflow-y-auto">
                <div className="text-sm text-[#1D1E1F] font-semibold">
                  {t("chunk.default_index")}
                </div>
                <div className="flex flex-col gap-3 mt-3">
                  {retrievalChunks.map((item) => {
                    const isRetrying = retryingRetrievalChunkId === item.id;
                    const status = getRetrievalChunkStatusMeta(
                      isRetrying
                        ? EMBEDDING_STATUS.PENDING
                        : item.embedding_status,
                    );
                    const failureReason =
                      item.embedding_status === EMBEDDING_STATUS.FAILED &&
                      item.error_reason
                        ? `失败原因：${item.error_reason}`
                        : undefined;

                    return (
                      <div
                        key={item.id}
                        className="border rounded p-4 bg-[#F8F9FB] group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-xs text-[#182B5099]">
                            #{numberToIndex(knowledge.chunk_index)}-
                            {numberToIndex(item.chunk_index)} |{" "}
                            {item.content.length} {t("common.string")}
                          </div>
                          {item.embedding_status === EMBEDDING_STATUS.FAILED ? (
                            <Button
                              type="text"
                              size="small"
                              loading={isRetrying}
                              disabled={
                                retryingRetrievalChunkId !== null && !isRetrying
                              }
                              icon={!isRetrying ? <ReloadOutlined /> : undefined}
                              onClick={() => void handleRetryEmbedding(item)}
                              className={`flex-none !inline-flex !h-auto items-center gap-1 rounded px-2 py-1 text-xs !border-none ${status.className}`}
                              title={failureReason}
                              aria-label="重新索引"
                            >
                              {isRetrying ? "排队中" : "重新索引"}
                            </Button>
                          ) : (
                            <div
                              className={`flex-none inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${status.className}`}
                              aria-label={status.label}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`}
                              />
                              {status.label}
                            </div>
                          )}
                        </div>
                        <div className="mt-2">
                          <EditorSection
                            value={item.content}
                            split={false}
                            disabled={true}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Summary Section */}
                <div className="text-sm text-[#1D1E1F] font-semibold mt-6 flex justify-between">
                  {t("chunk.summary")}
                </div>
                <div className="w-full flex flex-col gap-3 mt-3">
                  {summary.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-1 border-[#DCDFE6] rounded group relative"
                    >
                      <TextArea
                        value={item.content}
                        onChange={(e) => {
                          const newSummary = [...summary];
                          newSummary[index] = {
                            ...newSummary[index],
                            content: e.target.value,
                          };
                          setSummary(newSummary);
                        }}
                        rows={2}
                        style={{ backgroundColor: "#F8F9FA", resize: "none" }}
                        placeholder={t("form.input_placeholder")}
                      />
                      <DeleteOutlined
                        className="cursor-pointer invisible group-hover:visible absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
                        onClick={() => handleDelSummary(index)}
                      />
                    </div>
                  ))}
                  <Button
                    className="w-full !border-none"
                    color="primary"
                    variant="filled"
                    onClick={handleAddSummary}
                  >
                    {t("action.add")}
                  </Button>
                </div>

                {/* Questions Section */}
                <div className="text-sm text-[#1D1E1F] font-semibold mt-6 flex justify-between">
                  {t("chunk.question")}
                </div>
                <div className="w-full flex flex-col gap-3 mt-3">
                  {commonQuestions.map((item, index) => (
                    <Space.Compact
                      key={item.id}
                      className="flex items-center gap-1 border pr-2 border-[#DCDFE6] rounded-sm group relative"
                    >
                      <Input
                        value={item.content}
                        onChange={(e) => {
                          const newQuestions = [...commonQuestions];
                          newQuestions[index] = {
                            ...newQuestions[index],
                            content: e.target.value,
                          };
                          setCommonQuestions(newQuestions);
                        }}
                        placeholder={t("form.input_placeholder")}
                        variant="borderless"
                        style={{ borderColor: "transparent" }}
                      />
                      <DeleteOutlined
                        className="cursor-pointer invisible group-hover:visible  text-gray-400 hover:text-red-500"
                        onClick={() => handleDelCommonQuestion(index)}
                      />
                    </Space.Compact>
                  ))}
                  <Button
                    className="w-full !border-none"
                    color="primary"
                    variant="filled"
                    onClick={handleAddCommonQuestion}
                  >
                    {t("action.add")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          </Spin>
          </div>

          {/* Footer */}
          <div className="flex-none h-14 border-t flex items-center justify-end px-4 gap-2">
            <Button onClick={handleCancel}>{t("action.cancel")}</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {t("action.save")}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

EditDrawer.displayName = "EditDrawer";

export default EditDrawer;
