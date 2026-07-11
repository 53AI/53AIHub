import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import {
  Button,
  Input,
  Select,
  Switch,
  Empty,
  message,
  Modal,
  Tooltip,
  Spin,
} from "antd";
import {
  WarningFilled,
  EditOutlined,
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined
} from "@ant-design/icons";
import { useLibraryStore, type FileItem } from "@/stores/modules/library";
import { SvgIcon } from "@km/shared-components-react";
import chunksApi, {
  KnowledgeChunk,
  ChunkOperation,
  ChunkOperationsData,
  KnowledgeChunkRequestData,
} from "@/api/modules/chunks";
import filesApi from "@/api/modules/files";
import { CHUNK_STATUS, EMBEDDING_STATUS } from "@/constants/chunk";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { checkHasKMPermission } from "@/utils/km-permission";
import { deepCopy } from "@/utils";
import { smartSplitMarkdown } from "@/utils/markdown";
import VirtualList from "@/components/VirtualList";
import { markdownPreview } from "@/components/Markdown/helper";
import {
  EditDrawer,
  type EditDrawerRef,
} from "../../components/chunk/edit-drawer";
import ChunkStatus from "../../components/chunk/status";
import { t } from "@/locales";
import "./slice.css";

const POLLING_INTERVAL = 5000;

interface ChunkItem extends Omit<KnowledgeChunk, "id"> {
  id: string | number;
  origin_id?: string;
  recall_count?: number;
  retrieval_chunk_count?: number;
  children: {
    content: string;
    html: string;
  }[];
}

/**
 * Slice view component - chunk list with merge/split operations
 * Vue migration from slice.vue
 */
interface SliceViewProps {
  onStatusChange?: () => void;
}

export function SliceView({ onStatusChange }: SliceViewProps) {
  const libraryStore = useLibraryStore();
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chunkEditDrawerRef = useRef<EditDrawerRef>(null);

  // State
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [originalChunks, setOriginalChunks] = useState<ChunkItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [operations, setOperations] = useState<ChunkOperation[]>([]);
  const [contentUpdates, setContentUpdates] = useState<
    Record<string, { content: string }>
  >({});
  const [renderVersion, setRenderVersion] = useState(0);
  const [forcePolling, setForcePolling] = useState(false);

  // Refs for filter params - ensures reloadChunks gets latest values
  const filterRef = useRef({ status: "", keyword: "" });

  // Tooltip state
  const [tooltip, setTooltip] = useState({
    visible: false,
    content: "",
    style: { left: "0px", top: "0px" },
  });

  const currentFile = libraryStore.currentFile() as FileItem | undefined;

  // Computed values
  const isDisabled = useMemo(
    () => currentFile?.parsing_status === "disabled",
    [currentFile?.parsing_status],
  );

  const isPending = useMemo(
    () =>
      chunks.some((item) => item.embedding_status === EMBEDDING_STATUS.PENDING),
    [chunks],
  );

  const isIndexing = useMemo(
    () =>
      isPending ||
      chunks.some((item) => item.embedding_status === EMBEDDING_STATUS.PARSING),
    [chunks, isPending],
  );

  const failedChunks = useMemo(
    () =>
      chunks.filter(
        (item) => item.embedding_status === EMBEDDING_STATUS.FAILED,
      ),
    [chunks],
  );

  const pendingChunks = useMemo(
    () =>
      chunks.filter(
        (item) =>
          item.embedding_status === EMBEDDING_STATUS.PENDING ||
          item.embedding_status === EMBEDDING_STATUS.PARSING,
      ),
    [chunks],
  );

  const isSearching = useMemo(
    () => status !== "" || keyword !== "",
    [status, keyword],
  );

  const chunkStats = useMemo(
    () => ({
      token_count: chunks.reduce((acc, item) => acc + item.token_count, 0),
      recall_count: chunks.reduce((acc, item) => acc + item.recall_count, 0),
    }),
    [chunks],
  );

  const hasEditPermission = useMemo(
    () =>
      checkHasKMPermission(
        libraryStore.library?.permission || {},
        PERMISSION_TYPE.edit_all,
      ),
    [libraryStore.library?.permission],
  );

  const hasUnsavedOperations = useMemo(
    () => operations.length > 0,
    [operations],
  );

  // Tooltip methods
  const showTooltip = useCallback((content: string, event: MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const tooltipWidth = 120;
    const tooltipHeight = 32;

    let left = rect.left - 10;
    let top = rect.top - tooltipHeight - 8;

    if (left < 10) left = 10;
    if (left + tooltipWidth > window.innerWidth - 10) {
      left = window.innerWidth - tooltipWidth - 10;
    }
    if (top < 10) top = rect.bottom + 8;

    setTooltip({
      visible: true,
      content,
      style: { left: `${left}px`, top: `${top}px` },
    });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  const debouncedShowTooltip = useCallback(
    (content: string, event: MouseEvent) => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
      tooltipTimerRef.current = setTimeout(() => {
        showTooltip(content, event);
      }, 100);
    },
    [showTooltip],
  );

  const debouncedHideTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    hideTooltip();
  }, [hideTooltip]);

  // Render markdown content
  const renderMarkdownContent = useCallback(
    (content: string): Promise<{ content: string; html: string }> => {
      return new Promise((resolve) => {
        const node = document.createElement("div");
        node.style.cssText =
          "position:absolute;left:-9999px;top:-9999px;visibility:hidden;width:800px;";
        document.body.appendChild(node);

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let resolved = false;

        const cleanup = () => {
          try {
            if (document.body.contains(node)) {
              document.body.removeChild(node);
            }
          } catch (error) {
            console.warn("清理DOM节点时出错:", error);
          }
        };

        markdownPreview(node, content, {
          after: () => {
            const startTime = Date.now();
            const maxWaitTime = 5000;

            const waitForRender = () => {
              if (resolved) return;

              const unprocessedMermaid = node.querySelectorAll(
                '.language-mermaid:not([data-processed="true"])',
              );
              const unprocessedEcharts = node.querySelectorAll(
                '.language-echarts:not([data-processed="true"])',
              );
              const unprocessedFlowchart = node.querySelectorAll(
                '.language-flowchart:not([data-processed="true"])',
              );
              const unprocessedGraphviz = node.querySelectorAll(
                '.language-graphviz:not([data-processed="true"])',
              );
              const unprocessedMindmap = node.querySelectorAll(
                '.language-mindmap:not([data-processed="true"])',
              );

              const totalUnprocessed =
                unprocessedMermaid.length +
                unprocessedEcharts.length +
                unprocessedFlowchart.length +
                unprocessedGraphviz.length +
                unprocessedMindmap.length;

              if (
                totalUnprocessed === 0 ||
                Date.now() - startTime > maxWaitTime
              ) {
                resolved = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve({ content, html: node.innerHTML });
                cleanup();
                return;
              }

              requestAnimationFrame(waitForRender);
            };

            timeoutId = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve({ content, html: node.innerHTML });
                cleanup();
              }
            }, maxWaitTime + 1000);

            setTimeout(waitForRender, 100);
          },
        });
      });
    },
    [],
  );

  // Process chunk markdown
  const processChunkMarkdown = useCallback(
    (chunk: ChunkItem): Promise<ChunkItem> => {
      return new Promise((resolve) => {
        const blocks = smartSplitMarkdown(chunk.content);
        Promise.all(blocks.map((block) => renderMarkdownContent(block))).then(
          (children) => {
            resolve({ ...chunk, children });
          },
        );
      });
    },
    [renderMarkdownContent],
  );

  // Handle item visible
  const handleItemVisible = useCallback(
    (index: number, item: unknown, done: () => void) => {
      const chunkItem = item as ChunkItem;

      // Save current chunk id to prevent index misalignment after merge
      const chunkId = chunkItem.id.toString();

      // Skip if already has children
      if (chunkItem.children && chunkItem.children.length > 0) {
        done();
        return;
      }

      processChunkMarkdown(chunkItem)
        .then((res) => {
          setChunks((prev) => {
            // Verify the element at index is still the same chunk (prevent index misalignment from merge)
            if (prev[index]?.id.toString() === chunkId) {
              const newChunks = [...prev];
              newChunks[index] = res;
              return newChunks;
            }
            return prev;
          });
          done();
        })
        .catch((err) => {
          console.error(
            `[SliceView] processChunkMarkdown error: index=${index}`,
            err,
          );
          done();
        });
    },
    [processChunkMarkdown],
  );

  // Handle item hidden
  const handleItemHidden = useCallback((index: number, item: unknown) => {
    // Handle hidden item if needed
  }, []);

  // Handle chunk status change
  const handleChunkStatusChange = useCallback(
    async (chunk: KnowledgeChunk, newStatus: boolean) => {
      const data = chunks.find((item) => item.id === chunk.id);
      if (!data) return;

      try {
        if (newStatus) {
          await libraryStore.enableChunk(chunk);
        } else {
          await libraryStore.disabledChunk(chunk);
        }
        data.status = newStatus ? CHUNK_STATUS.ENABLED : CHUNK_STATUS.DISABLED;
        setChunks([...chunks]);
      } catch (error) {
        console.error("Failed to change chunk status:", error);
      }
    },
    [chunks, libraryStore],
  );

  // Handle toggle parsing status
  const handleToggleParsingStatus = useCallback(() => {
    if (!currentFile) return;
    const fileId = currentFile.id;
    const newStatus =
      currentFile.parsing_status !== "disabled" ? "disabled" : "normal";
    const confirmText =
      newStatus === "disabled"
        ? t("chunk.disable_confirm")
        : t("chunk.enable_confirm");

    Modal.confirm({
      title: t("common.tip"),
      content: confirmText,
      okText: t("action.confirm"),
      cancelText: t("action.cancel"),
      onOk: async () => {
        await filesApi.indexStatus(fileId, { status: newStatus });
        libraryStore.loadFile(fileId);
        onStatusChange?.();
      },
    });
  }, [currentFile, libraryStore, onStatusChange, t]);

  // Handle delete chunk
  const handleDel = useCallback(
    (chunk: KnowledgeChunk) => {
      Modal.confirm({
        title: t("common.tip"),
        content: t("chunk.delete_confirm"),
        okText: t("action.confirm"),
        cancelText: t("action.cancel"),
        onOk: async () => {
          await libraryStore.deleteChunk(chunk);
          setChunks((prev) => prev.filter((item) => item.id !== chunk.id));
          message.success(t("action.delete_success"));
        },
      });
    },
    [libraryStore, t],
  );

  // Handle edit
  const handleEdit = useCallback((chunk: ChunkItem) => {
    chunkEditDrawerRef.current?.open(chunk as unknown as KnowledgeChunk);
  }, []);

  // Handle chunk edit success
  const handleChunkEditSuccess = useCallback(
    (data: KnowledgeChunkRequestData) => {
      libraryStore.updateChunkContent({
        ...data,
        id: data.chunk_id,
      } as KnowledgeChunk);
      const chunk = chunks.find((item) => item.id === data.chunk_id);
      if (!chunk) return;
      chunk.content = data.content;
      processChunkMarkdown(chunk).then((res) => {
        chunk.children = res.children;
        setChunks((prev) => [...prev]);
      });
    },
    [chunks, libraryStore, processChunkMarkdown],
  );

  // Use ref for polling to always call latest reloadChunks
  const reloadChunksRef = useRef<
    ((reRender?: boolean) => Promise<void>) | null
  >(null);

  // Reload chunks - defined before other callbacks that depend on it
  const reloadChunks = useCallback(
    async (reRender = true) => {
      if (reRender) {
        setChunks([]);
        setRenderVersion((v) => v + 1);
      }

      try {
        // Use filterRef to get latest filter values
        const { status: currentStatus, keyword: currentKeyword } =
          filterRef.current;
        const res = await chunksApi.files.list(currentFile?.id || "", {
          status: currentStatus,
          keyword: currentKeyword,
        });

        if (reRender) {
          // ReRender mode: initialize all items with empty children
          setChunks(res.chunks.map((item) => ({ ...item, children: [] })));
        } else {
          // Non-reRender mode: keep existing children, new items have no children property
          setChunks((prev) => {
            const newChunks = res.chunks.map((item) => {
              const chunk = prev.find((c) => c.id === item.id);
              if (chunk) {
                // Keep existing item with its children, only update status
                return { ...chunk, embedding_status: item.embedding_status };
              }
              // New item: initialize with empty children
              return { ...item, children: [] } as ChunkItem;
            });

            // Check if there are new items without children
            const hasNewItems = newChunks.some(
              (c) => !c.children || c.children.length === 0,
            );
            if (hasNewItems) {
              setRenderVersion((v) => v + 1);
            }

            return newChunks;
          });
        }

        // Check if all chunks have completed indexing, turn off forcePolling
        const hasPending = res.chunks.some(
          (item) =>
            item.embedding_status === EMBEDDING_STATUS.PENDING ||
            item.embedding_status === EMBEDDING_STATUS.PARSING,
        );
        if (!hasPending) {
          setForcePolling(false);
        }
      } catch (error) {
        console.error("加载切片失败:", error);
      }
    },
    [currentFile?.id],
  );

  // Update ref
  useEffect(() => {
    reloadChunksRef.current = reloadChunks;
  }, [reloadChunks]);

  // Auto-polling effect - poll while pending chunks exist or forcePolling is true
  // Use setInterval with ref to ensure continuous polling even when pendingChunks.length doesn't change
  const pollingEnabledRef = useRef(false);

  useEffect(() => {
    const shouldPoll = pendingChunks.length > 0 || forcePolling;

    if (shouldPoll && !pollingEnabledRef.current) {
      // Start polling
      pollingEnabledRef.current = true;
      const intervalId = setInterval(() => {
        reloadChunksRef.current?.(false);
      }, POLLING_INTERVAL);

      return () => {
        pollingEnabledRef.current = false;
        clearInterval(intervalId);
      };
    } else if (!shouldPoll && pollingEnabledRef.current) {
      // Stop polling - let the cleanup from above handle it by triggering a re-render
      pollingEnabledRef.current = false;
    }
  }, [pendingChunks.length, forcePolling]);

  // Handle retry indexing
  const handleRetryIndexing = useCallback(
    async (chunk?: ChunkItem) => {
      const updateChunks = chunk
        ? [chunk]
        : chunks.filter(
            (item) =>
              item.embedding_status === EMBEDDING_STATUS.FAILED ||
              item.embedding_status === EMBEDDING_STATUS.PARSING,
          );

      setIsRetrieving(true);
      try {
        await chunksApi.files.batch(String(currentFile?.id || 0), {
          update_retrieval_chunk: true,
          content_updates: updateChunks.reduce(
            (acc, item) => {
              acc[String(item.id)] = { content: item.content };
              return acc;
            },
            {} as Record<string, { content: string }>,
          ),
          operations: [],
        });
        message.success(t("status.submitted"));
        reloadChunks(false);
      } catch (error) {
        console.error("重试索引失败:", error);
      } finally {
        setIsRetrieving(false);
      }
    },
    [chunks, currentFile?.id, reloadChunks, t],
  );

  // Handle merge
  const handleMerge = useCallback(
    (index: number) => {
      if (index === 0) return;
      if (originalChunks.length === 0) {
        setOriginalChunks(deepCopy(chunks));
      }

      const previousChunk = chunks[index - 1];
      const currentChunk = chunks[index];
      const previousChunkId = previousChunk.id.toString();
      const currentChunkId = currentChunk.id.toString();

      // Update content
      const content = `${previousChunk.content}\n${currentChunk.content}`;
      previousChunk.content = content;

      setContentUpdates((updates) => {
        const newUpdates = { ...updates, [previousChunkId]: { content } };
        delete newUpdates[currentChunkId];
        return newUpdates;
      });

      // Handle temp_ blocks (split generated temporary blocks)
      let skipMergeOp = false;
      if (currentChunkId.includes("temp_")) {
        const splitOpIndex = operations.findIndex(
          (item) => item.identifier === currentChunkId,
        );
        if (splitOpIndex !== -1) {
          const splitOp = operations[splitOpIndex];
          // Check if merging back after split (cancel operation)
          if (
            splitOp.action === "split" &&
            splitOp.origin_identifier === previousChunkId
          ) {
            // Split then merge back → cancel operation, delete split
            setOperations((ops) => {
              const newOps = [...ops];
              newOps.splice(splitOpIndex, 1);
              return newOps;
            });
            setContentUpdates((updates) => {
              const newUpdates = { ...updates };
              delete newUpdates[currentChunkId];
              newUpdates[previousChunkId] = { content };
              return newUpdates;
            });
            skipMergeOp = true;
          } else {
            // Not cancelling operation, delete split record and continue
            setOperations((ops) => {
              const newOps = [...ops];
              newOps.splice(splitOpIndex, 1);
              return newOps;
            });
          }
        }
      }

      if (!skipMergeOp) {
        // Check if previousChunk has related split operation (non temp_ scenario)
        const splitOpOfPrevious = operations.find(
          (item) =>
            item.action === "split" &&
            item.origin_identifier === previousChunkId &&
            item.identifier === currentChunkId,
        );
        if (splitOpOfPrevious) {
          // Merging a split block → cancel split operation
          const splitIndex = operations.indexOf(splitOpOfPrevious);
          setOperations((ops) => {
            const newOps = [...ops];
            newOps.splice(splitIndex, 1);
            return newOps;
          });
          setContentUpdates((updates) => {
            const newUpdates = { ...updates };
            delete newUpdates[currentChunkId];
            newUpdates[previousChunkId] = { content };
            return newUpdates;
          });
        } else {
          // Normal merge logic
          const currentMergeOp = operations.find(
            (item) =>
              item.action === "merge" && item.identifier === currentChunkId,
          );
          const existingMergeOp = !currentMergeOp
            ? operations.find(
                (item) =>
                  item.action === "merge" &&
                  item.identifier === previousChunkId,
              )
            : null;

          if (currentMergeOp && existingMergeOp) {
            existingMergeOp.merge_identifiers = [
              ...(existingMergeOp.merge_identifiers || []),
              ...(currentMergeOp.merge_identifiers || []),
            ];
            existingMergeOp.content = content;
            setOperations((ops) =>
              ops.filter((item) => item !== currentMergeOp),
            );
          } else if (currentMergeOp) {
            setOperations((ops) => {
              const newOps = ops.map((item) =>
                item === currentMergeOp
                  ? {
                      ...item,
                      identifier: previousChunkId,
                      merge_identifiers: [
                        previousChunkId,
                        ...(item.merge_identifiers || []),
                      ],
                      content,
                    }
                  : item,
              );
              return newOps;
            });
          } else if (existingMergeOp) {
            setOperations((ops) => {
              const newOps = ops.map((item) =>
                item === existingMergeOp
                  ? {
                      ...item,
                      merge_identifiers: [
                        ...(item.merge_identifiers || []),
                        currentChunkId,
                      ],
                      content,
                    }
                  : item,
              );
              return newOps;
            });
          } else {
            setOperations((ops) => [
              ...ops,
              {
                action: "merge",
                identifier: previousChunkId,
                content,
                merge_identifiers: [previousChunkId, currentChunkId],
              },
            ]);
          }
        }
      }

      // Update UI display
      setChunks((prev) => {
        const newChunks = [...prev];
        newChunks.splice(index, 1);
        return newChunks;
      });

      // Re-render markdown
      processChunkMarkdown(previousChunk).then((res) => {
        previousChunk.children = res.children;
        setChunks((prev) => [...prev]);
      });
    },
    [chunks, originalChunks, operations, processChunkMarkdown],
  );

  // Handle split
  const handleSplit = useCallback(
    (index: number, chunkIndex: number) => {
      if (originalChunks.length === 0) {
        setOriginalChunks(deepCopy(chunks));
      }

      const chunk = chunks[index];
      const isTemp = chunk.id.toString().includes("temp_");

      const prevContent = chunk.children
        .slice(0, chunkIndex + 1)
        .map((item) => item.content)
        .join("\n");
      const nextContent = chunk.children
        .slice(chunkIndex + 1)
        .map((item) => item.content)
        .join("\n");

      chunk.content = prevContent;

      const newChunk: ChunkItem = {
        id: `temp_${Date.now()}`,
        content: nextContent,
        chunk_index: chunk.chunk_index + 1,
        status: CHUNK_STATUS.ENABLED,
        origin_id: isTemp ? chunk.origin_id : chunk.id.toString(),
        token_count: 0,
        recall_count: 0,
        retrieval_chunk_count: 0,
        embedding_status: "normal",
        children: [],
      };

      if (isTemp) {
        const nextChunk = chunks[index + 1] || ({} as ChunkItem);
        const currentChunkId = Number(chunk.id.toString().split("_")[1]);
        if (nextChunk.origin_id && chunk.origin_id === newChunk.origin_id) {
          const nextChunkId = Number(nextChunk.id.toString().split("_")[1]);
          newChunk.id = `temp_${parseInt(String((currentChunkId + nextChunkId) / 2))}`;
        } else {
          newChunk.id = `temp_${currentChunkId + 1000}`;
        }
      } else {
        // Find last split operation matching the chunk id
        const splitChunk = [...operations]
          .reverse()
          .find((item) => item.origin_identifier === chunk.id.toString());
        if (splitChunk) {
          newChunk.id = `temp_${Number(splitChunk.identifier.split("_")[1]) - 1000}`;
        }
      }

      // Update original chunk content
      setContentUpdates((updates) => ({
        ...updates,
        [chunk.id.toString()]: { content: prevContent },
        [newChunk.id.toString()]: { content: nextContent },
      }));

      // Add split operation
      setOperations((ops) => [
        ...ops,
        {
          action: "split",
          identifier: newChunk.id.toString(),
          content: nextContent,
          origin_identifier: chunk.origin_id || chunk.id.toString(),
        },
      ]);

      // Insert new chunk
      setChunks((prev) => {
        const newChunks = [...prev];
        newChunks.splice(index + 1, 0, newChunk);
        return newChunks;
      });

      // Re-render markdown
      Promise.all([
        processChunkMarkdown(chunk),
        processChunkMarkdown(newChunk),
      ]).then(([res1, res2]) => {
        chunk.children = res1.children;
        newChunk.children = res2.children;
        setChunks((prev) => [...prev]);
      });
    },
    [chunks, originalChunks, operations, processChunkMarkdown],
  );

  // Handle cancel operations
  const handleCancelOperations = useCallback(() => {
    setChunks(deepCopy(originalChunks));
    setOperations([]);
    setContentUpdates({});
  }, [originalChunks]);

  // Save modal state
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Handle save operations - open modal
  const handleSaveOperations = useCallback(() => {
    setSaveModalVisible(true);
  }, []);

  // Handle save with reindex (update)
  const handleSaveWithReindex = useCallback(async () => {
    setIsSaving(true);
    try {
      const data: ChunkOperationsData = {
        update_retrieval_chunk: true,
        content_updates: contentUpdates,
        operations,
      };

      await chunksApi.files.batch(currentFile?.id || 0, data);

      setOperations([]);
      setContentUpdates({});
      setSaveModalVisible(false);
      message.success(t("status.save_success"));

      // Force polling to start immediately after save
      // This ensures status updates are detected even if server status isn't updated yet
      setForcePolling(true);
      reloadChunks(false);
    } catch (error) {
      console.error("保存操作失败:", error);
      message.error(t("status.save_fail"));
    } finally {
      setIsSaving(false);
    }
  }, [contentUpdates, operations, currentFile?.id, reloadChunks, t]);

  // Handle save without reindex
  const handleSaveWithoutReindex = useCallback(async () => {
    setIsSaving(true);
    try {
      const data: ChunkOperationsData = {
        update_retrieval_chunk: false,
        content_updates: contentUpdates,
        operations,
      };

      await chunksApi.files.batch(currentFile?.id || 0, data);

      setOperations([]);
      setContentUpdates({});
      setSaveModalVisible(false);
      message.success(t("status.save_success"));
      reloadChunks();
    } catch (error) {
      console.error("保存操作失败:", error);
      message.error(t("status.save_fail"));
    } finally {
      setIsSaving(false);
    }
  }, [contentUpdates, operations, currentFile?.id, reloadChunks, t]);

  // Handle modal cancel - distinguish close button vs cancel button
  const handleSaveModalCancel = useCallback((e: React.MouseEvent) => {
    // Check if user clicked close button (X) vs "取消" button
    const target = e.target as HTMLElement;
    const isCloseButton = target?.closest?.(".ant-modal-close");
    // If clicked close button (X), just close without saving
    if (isCloseButton) {
      setSaveModalVisible(false);
      return;
    }
    // If clicked "取消" button, also just close without saving
    setSaveModalVisible(false);
  }, []);

  // Initialize
  const initChunks = useCallback(async () => {
    try {
      setIsLoading(true);
      await reloadChunks(true);
    } catch (error) {
      console.error("初始化失败:", error);
    } finally {
      setIsLoading(false);
    }
  }, [reloadChunks]);

  useEffect(() => {
    initChunks();
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  // Render chunk item
  const renderChunkItem = (item: ChunkItem, index: number) => (
    <div key={item.id}>
      {/* Merge button */}
      {index > 0 &&
      pendingChunks.length === 0 &&
      hasEditPermission &&
      !isSearching &&
      !isDisabled ? (
        <div
          className="merge-mark -ml-5 w-4 h-4 pl-[2.5px] rounded-sm cursor-pointer hover:bg-[#2563EB] hover:text-white"
          onClick={() => handleMerge(index)}
          onMouseEnter={(e) =>
            debouncedShowTooltip("合并切片", e as unknown as MouseEvent)
          }
          onMouseLeave={debouncedHideTooltip}
        >
          <SvgIcon name="tb-merge" size={14} />
        </div>
      ) : (
        <div className="h-4" />
      )}

      {/* Chunk card */}
      <div
        className={`px-4 py-2 group rounded bg-white shadow ${item.status === "disabled" || isDisabled ? "opacity-50" : ""}`}
      >
        <div className="h-8 flex items-center gap-2">
          <div className="text-xs text-[#2563EB] h-[22px] px-1.5 bg-[#F0F5FF] flex items-center rounded">
            #{index.toString().padStart(2, "0")}
          </div>
          <div className="w-px h-3 bg-[#E6E8EB] invisible group-hover:visible" />
          <p className="flex-1 text-xs text-[#999999] invisible group-hover:visible">
            Token：{item.token_count} · 命中：{item.recall_count || 0} ·
            默认索引：{item.retrieval_chunk_count || 0}
          </p>

          {/* Status indicators */}
          {item.embedding_status === EMBEDDING_STATUS.FAILED && (
            <div className="h-6 px-2 rounded bg-[#FFEDED] flex items-center gap-1">
              <WarningFilled className="text-[#FA5151]" />
              <span className="text-sm text-[#FA5151]">索引失败</span>
              {hasEditPermission && (
                <Button
                  type="link"
                  className="px-0 gap-0"
                  loading={isRetrieving}
                  onClick={() => handleRetryIndexing(item)}
                >
                  <ReloadOutlined className="mr-1" />
                  重试
                </Button>
              )}
            </div>
          )}

          {item.embedding_status === EMBEDDING_STATUS.PENDING && (
            <div className="h-6 px-2 rounded bg-[#f5f4f4] flex items-center gap-1">
              <span className="text-sm">排队中</span>
            </div>
          )}

          {item.embedding_status === EMBEDDING_STATUS.PARSING && (
            <div className="h-6 px-2 rounded bg-[#f5f4f4] flex items-center gap-1">
              <span className="text-sm">索引中</span>
              {hasEditPermission && (
                <Button
                  type="link"
                  className="px-0 gap-0"
                  loading={isRetrieving}
                  onClick={() => handleRetryIndexing(item)}
                >
                  <ReloadOutlined className="mr-1" />
                  重试
                </Button>
              )}
            </div>
          )}

          {/* Actions */}
          {!hasUnsavedOperations &&
            pendingChunks.length === 0 &&
            !isDisabled &&
            hasEditPermission && (
              <div className="flex items-center gap-2">
                <ChunkStatus
                  value={item.status === "enabled"}
                  onChange={(checked) =>
                    handleChunkStatusChange(
                      item as unknown as KnowledgeChunk,
                      checked,
                    )
                  }
                />
                <Button
                  type="link"
                  className="hidden group-hover:inline-flex px-0"
                  onClick={() => handleEdit(item)}
                >
                  <EditOutlined />
                  <span>{t("action.edit")}</span>
                </Button>
                <DeleteOutlined
                  className="hidden group-hover:inline-flex cursor-pointer text-gray-400"
                  onClick={() => handleDel(item as unknown as KnowledgeChunk)}
                />
              </div>
            )}
        </div>

        {/* Content */}
        <div
          className="vditor-chunk vditor-reset py-1"
          style={{ overflow: "initial" }}
        >
          {item.children?.length === 0 ? (
            <div className="h-60 flex items-center justify-center py-4 text-gray-500">
              <LoadingOutlined className="mr-2" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : (
            item.children?.map((child, chunkIndex) => (
              <div key={chunkIndex} className="group/item -ml-9">
                <div
                  className="ml-9"
                  dangerouslySetInnerHTML={{ __html: child.html }}
                />
                {chunkIndex !== item.children.length - 1 &&
                  pendingChunks.length === 0 &&
                  hasEditPermission &&
                  !isSearching &&
                  !isDisabled && (
                    <div className="relative z-10 w-10 h-1 flex items-center group/split -mr-3 invisible hover:w-auto group-hover/item:visible">
                      <div
                        className="w-4 h-4 rounded-sm flex items-center justify-center cursor-pointer group-hover/split:text-white group-hover/split:bg-[#2563eb]"
                        onClick={() => handleSplit(index, chunkIndex)}
                        onMouseEnter={(e) =>
                          debouncedShowTooltip(
                            "拆分切片",
                            e as unknown as MouseEvent,
                          )
                        }
                        onMouseLeave={debouncedHideTooltip}
                      >
                        <SvgIcon name="tb-split" />
                      </div>
                      <div className="ml-1 border-t border-dashed border-[#182b50] flex-1 group-hover/split:border-[#2563EB]" />
                    </div>
                  )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="slice-view flex flex-col flex-1 overflow-hidden">
      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="fixed z-[9999] px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg pointer-events-none transition-opacity duration-200"
          style={tooltip.style as React.CSSProperties}
        >
          {tooltip.content}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex-none h-[52px] px-5 flex items-center">
        <div className="flex items-center gap-2">
          <div className="flex-none w-32">
            <Select
              value={status}
              onChange={(val) => {
                const newStatus = val ?? "";
                setStatus(newStatus);
                filterRef.current.status = newStatus;
                reloadChunks(true);
              }}
              placeholder="请选择状态"
              className="w-full"
              options={[
                { label: "全部", value: "" },
                { label: "已启用", value: "enabled" },
                { label: "已禁用", value: "disabled" },
              ]}
            />
          </div>
          <div className="flex-none w-60">
            <Input.Search
              value={keyword}
              onChange={(e) => {
                const newKeyword = e.target.value;
                setKeyword(newKeyword);
                filterRef.current.keyword = newKeyword;
                if (newKeyword === "") {
                  reloadChunks(true);
                }
              }}
              placeholder="搜索"
              allowClear
              enterButton="搜索"
              onSearch={() => reloadChunks(true)}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {isPending && <div className="text-secondary text-sm">排队中</div>}

          {isIndexing && !isPending && (
            <Tooltip title="索引中，不支持拆分、合并和编辑等操作">
              <div className="flex-none h-8 px-2.5 flex items-center gap-1 rounded bg-[#FFF2E6]">
                <img
                  className="size-3"
                  src="/images/file/indexing.webp"
                  alt="indexing"
                />
                <span className="text-sm text-[#EE7702]">索引中</span>
                {hasEditPermission && (
                  <Button
                    type="link"
                    loading={isRetrieving}
                    onClick={() => handleRetryIndexing()}
                  >
                    <ReloadOutlined className="mr-1" />
                    重试
                  </Button>
                )}
              </div>
            </Tooltip>
          )}

          {hasUnsavedOperations && (
            <>
              <Button onClick={handleCancelOperations}>取消</Button>
              <Button type="primary" onClick={handleSaveOperations}>
                保存
              </Button>
            </>
          )}

          {!isIndexing && !hasUnsavedOperations && failedChunks.length > 0 && (
            <div className="h-10 px-2 rounded bg-[#FFFBF2] flex items-center gap-1">
              <WarningFilled className="text-[#F0A105]" />
              <span className="text-sm text-[#4F5052]">
                共有{chunks.length}个切片, 成功索引
                {chunks.length - failedChunks.length}个，失败
                {failedChunks.length}个
              </span>
              {hasEditPermission && (
                <Button
                  type="link"
                  loading={isRetrieving}
                  onClick={() => handleRetryIndexing()}
                >
                  <ReloadOutlined className="mr-1" />
                  重试
                </Button>
              )}
            </div>
          )}

          {!isIndexing &&
            !hasUnsavedOperations &&
            chunks.length > 0 &&
            failedChunks.length === 0 && (
              <>
                <p className="text-xs text-[#939499]">
                  Token:{" "}
                  <span className="text-[#1D1E1F]">
                    {chunkStats.token_count}
                  </span>
                </p>
                ·
                <p className="text-xs text-[#939499]">
                  语料切片：
                  <span className="text-[#1D1E1F]">{chunks.length}</span>
                </p>
                ·
                <p className="text-xs text-[#939499]">
                  语料命中：
                  <span className="text-[#1D1E1F]">
                    {chunkStats.recall_count}
                  </span>
                </p>
              </>
            )}

          {hasEditPermission && (
            <div
              className="group flex items-center cursor-pointer px-3 py-1 border border-gray-200 rounded hover:border-blue-400 hover:text-blue-500"
              onClick={handleToggleParsingStatus}
            >
              <div
                className={`w-3 h-3 rounded-full mr-2 ${!isDisabled ? "bg-[#09BB07] border-2 border-[#cfedd6]" : "bg-[#FA5151] border-2 border-[#f4e1de]"}`}
              />
              <span className="text-sm">
                {!isDisabled ? "已启用" : "已停用"}
              </span>
              <div className="hidden ml-1 group-hover:inline-flex">
                <Switch
                  size="small"
                  checked={!isDisabled}
                  style={{
                    backgroundColor: !isDisabled ? "#34bc24" : undefined,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chunk List */}
      <div className="flex-1 bg-[#FAFAFB] overflow-y-auto pb-5">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Spin size="large" />
          </div>
        ) : chunks.length > 0 ? (
          <VirtualList
            items={chunks}
            itemHeight={100}
            resetKey={renderVersion}
            className="pb-5"
            wrapperClass="max-w-4xl mx-auto py-5"
            onItemVisible={handleItemVisible}
            onItemHidden={handleItemHidden}
            renderItem={renderChunkItem}
          />
        ) : (
          <Empty description={t("common.no_data")} />
        )}
      </div>

      {/* Chunk Edit Drawer */}
      <EditDrawer
        ref={chunkEditDrawerRef}
        file={currentFile}
        onSuccess={handleChunkEditSuccess}
      />

      {/* Save Confirmation Modal */}
      <Modal
        open={saveModalVisible}
        title={t("common.tip")}
        closable={true}
        maskClosable={false}
        onCancel={handleSaveModalCancel}
        footer={
          <div className="flex justify-end gap-2">
            {/* <Button onClick={handleSaveModalCancel}>
              {t("action.cancel")}
            </Button> */}
            <Button loading={isSaving} onClick={handleSaveWithoutReindex}>
              {t("action.not_update")}
            </Button>
            <Button type="primary" loading={isSaving} onClick={handleSaveWithReindex}>
              {t("action.update")}
            </Button>
          </div>
        }
      >
        {t("chunk.reindex_confirm", {
          count: Object.keys(contentUpdates).length,
        })}
      </Modal>
    </div>
  );
}

export default SliceView;
