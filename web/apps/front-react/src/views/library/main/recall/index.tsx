import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button, Input, Table, message } from "antd";
import { EditOutlined, LoadingOutlined } from "@ant-design/icons";

import { markdownPreview } from "@/components/Markdown/helper";

import chunksApi from "@/api/modules/chunks";
import filesApi from "@/api/modules/files/index";
import { formatFile, formatFileInfo } from "@/api/modules/files/transform";
import librariesApi, { type SearchConfig } from "@/api/modules/libraries";
import agentsApi from "@/api/modules/agents";
import { AGENT_USAGES } from "@/constants/agent";
import { CHUNK_STATUS } from "@/constants/chunk";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import { getSimpleDateFormatString } from "@km/shared-utils";

import { LibraryHeader as Header } from "../../components/header";
import { ChunkStatus } from "../components/chunk/status";
import ChunkEditDrawer, {
  type EditDrawerRef,
} from "../components/chunk/edit-drawer";

import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

interface ResultItem {
  chunk_id: number;
  knowledge_chunk_id: number;
  knowledge_chunk_status: string;
  chunk_type: string;
  content: string;
  file_id: string;
  file_name: string;
  highlighted: string;
  score: number;
  isHighlight: boolean;
  vector_score: number;
}

export function LibraryRecallView() {
  const { id } = useParams<{ id: string }>();

  const chunkEditDrawerRef = useRef<EditDrawerRef>(null);
  const requestIdRef = useRef(0);

  const [inputFocus, setInputFocus] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [file, setFile] = useState<any>();
  const [topNum, setTopNum] = useState(0);

  const [isEmpty, setIsEmpty] = useState(true);
  const [loading, setLoading] = useState(false);

  const [historyList, setHistoryList] = useState<any[]>([]);
  const [resultList, setResultList] = useState<ResultItem[]>([]);
  const [agentInfo, setAgentInfo] = useState<any>(null);

  const [configSetting, setConfigSetting] = useState({
    page: 1,
    page_size: 10,
    total: 0,
  });

  const handleChunkStatusChange = (chunkId: number, status: boolean) => {
    const apiMethod = status ? chunksApi.enable : chunksApi.disable;
    const targetStatus = status ? CHUNK_STATUS.ENABLED : CHUNK_STATUS.DISABLED;

    apiMethod(chunkId).then(() => {
      setResultList((prev) =>
        prev.map((item) => {
          if (item.knowledge_chunk_id === chunkId) {
            return { ...item, knowledge_chunk_status: targetStatus };
          }
          return item;
        }),
      );
    });
  };

  const handleRowClick = (row: any) => {
    setInputValue(row.query_text);
  };

  const handleEdit = async (chunk_id: number, file_id: string) => {
    const fileItem = await filesApi.get(file_id);
    const chunk = await chunksApi.get(chunk_id);
    const formattedFile = formatFile(fileItem);
    chunkEditDrawerRef.current?.open(chunk, formattedFile);
  };

  const loadHistoryList = useCallback(
    async (page: number, pageSize: number) => {
      if (!id) return;
      const requestId = ++requestIdRef.current;
      try {
        const list = await librariesApi.searchHistory(id, {
          page: page,
          page_size: pageSize,
        });
        if (requestId !== requestIdRef.current) return;

        setConfigSetting((prev) => ({
          ...prev,
          page,
          page_size: pageSize,
          total: list.total,
        }));

        setHistoryList(
          list.queries.map((item: any) => {
            const time = getSimpleDateFormatString({
              date: item.updated_time,
              format: "YYYY-MM-DD hh:mm",
            });
            return {
              ...item,
              updated_time: time,
            };
          }),
        );
      } catch (error) {
        console.error(error);
      }
    },
    [id],
  );

  useEffect(() => {
    loadHistoryList(1, 10);
    loadModelSetting();
  }, [id, loadHistoryList]);

  const loadModelSetting = async () => {
    try {
      const res = await agentsApi.list({
        agent_usages: AGENT_USAGES.KM_AI_SEARCH,
      });
      const agent = res.agents[0];
      if (agent) {
        setAgentInfo(transformAgentInfo(agent));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const refresh = () => {
    loadHistoryList(1, configSetting.page_size);
  };

  const handleTest = async () => {
    const rerankConfig = agentInfo?.settings?.rerank_config;
    if (!inputValue) return;
    if (!rerankConfig) {
      message.error(t("recall.need_model"));
      return;
    }

    setLoading(true);
    const scoreThreshold = rerankConfig.score_threshold;
    const topK = rerankConfig.top_k;
    const SCORE_THRESHOLD = 0;
    const MAX_TOP_K = 10;
    const config: SearchConfig = {
      query: inputValue,
      search_config: {
        ...rerankConfig,
        score_threshold: SCORE_THRESHOLD,
        top_k: MAX_TOP_K,
      },
    };

    if (!id) {
      setLoading(false);
      return;
    }

    try {
      const list = await librariesApi.searchResult(id, config);
      setTopNum(list.total);

      const newResultList = list.results.map((item: any, index: number) => ({
        ...item,
        isHighlight: item.score >= scoreThreshold && index < topK,
        score: Math.round(item.score * 100 * 100) / 100,
        file_name: formatFileInfo(item.file_name).fname,
      }));

      setResultList(newResultList);
      setLoading(false);
      setIsEmpty(!(newResultList.length > 0));
      refresh();
    } catch (error) {
      setLoading(false);
      setIsEmpty(true);
    }
  };

  const onTableSizeChange = (size: number) => {
    setConfigSetting((prev) => ({ ...prev, page_size: size }));
    loadHistoryList(1, size);
  };

  const onTableCurrentChange = (current: number) => {
    setConfigSetting((prev) => ({ ...prev, page: current }));
    loadHistoryList(current, configSetting.page_size);
  };

  markdownPreview("", "");

  return (
    <div className="flex-1 h-screen flex flex-col overflow-hidden bg-[#F8F9FA]">
      <Header>
        <h3 className="text-base text-[#1D1E1F]">{t("recall.recall")}</h3>
      </Header>
      <div className="bg-[#ffffff] flex-1 gap-6 overflow-y-auto mb-5">
        <div className="flex h-full">
          <aside
            className="px-6 py-5 border-r h-full flex-none"
            style={{ width: "46%" }}
          >
            <div className="text-sm text-[#999999] text-opacity-60">
              {t("recall.quiz_tip")}
            </div>
            <div
              className={`border px-4 py-3 mt-4 rounded-md ${inputFocus ? "border-[#2563EB]" : ""}`}
            >
              <div className="text-sm text-regular">{t("recall.quiz")}</div>
              <Input.TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="mt-2"
                autoSize={{ minRows: 8, maxRows: 8 }}
                style={{ border: "none", boxShadow: "none", padding: 0 }}
                placeholder={t("recall.input_placeholder")}
                onFocus={() => setInputFocus(true)}
                onBlur={() => setInputFocus(false)}
              />
              <div className="flex flex-row-reverse mt-2">
                <Button
                  type="primary"
                  disabled={!inputValue}
                  loading={loading}
                  onClick={handleTest}
                >
                  {t("recall.test")}
                </Button>
              </div>
            </div>

            <div className="text-[#999999] text-opacity-60 text-sm mt-7">
              {t("recall.recent_search")}
            </div>
            <Table
              className="w-full cursor-pointer mt-4"
              dataSource={historyList}
              rowKey={(record: any, index: number) =>
                `history-${record.query_text}-${record.updated_time}-${index}`
              }
              pagination={{
                current: configSetting.page,
                pageSize: configSetting.page_size,
                total: configSetting.total,
                onChange: onTableCurrentChange,
                onShowSizeChange: (_, size) => onTableSizeChange(size),
              }}
              onRow={(row) => ({
                onClick: () => handleRowClick(row),
              })}
              columns={[
                {
                  title: t("recall.query"),
                  dataIndex: "query_text",
                  ellipsis: true,
                  render: (text) => (
                    <div className="truncate max-w-[450px] min-w-[200px]">
                      {text}
                    </div>
                  ),
                },
                {
                  title: t("recall.time"),
                  dataIndex: "updated_time",
                  width: 150,
                  ellipsis: true,
                },
              ]}
            />
          </aside>

          <main className="w-full overflow-y-auto">
            {loading ? (
              <div className="h-full flex flex-col gap-2 items-center justify-center">
                <LoadingOutlined className="animate-spin text-xl text-[#409EFF]" />
                <span className="text-sm text-regular text-opacity-60">
                  {t("common.loading")}...
                </span>
              </div>
            ) : isEmpty ? (
              <div className="h-full flex flex-col items-center justify-center">
                <div style={{ width: "104px" }}>
                  <img src={getPublicPath("/images/empty.png")} alt="empty" />
                </div>
                <div className="text-sm text-regular text-opacity-60">
                  {t("recall.show_result")}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 mt-4 px-6">
                {t("recall.match", { count: topNum })}
                {resultList.map((item) => (
                  <div
                    key={item.chunk_id}
                    className={`group rounded cursor-pointer relative hover:shadow ${item.isHighlight ? "bg-gradient-to-b from-[#f0f5ff] to-[#f8f9fa]" : "bg-[#F6F7F8]"}`}
                  >
                    <div className="relative z-[1] h-10 px-4 py-2 flex items-center justify-between border-b overflow-hidden">
                      <div className="flex-1 flex items-center text-xs text-regular text-opacity-80 truncate">
                        <span>{t("recall.score", { score: item.score })}</span>
                        <span className="px-1">|</span>
                        <span>
                          {t("recall.scoure", { file: item.file_name })}
                        </span>
                      </div>
                      <div className="flex-none flex items-center">
                        <ChunkStatus
                          value={item.knowledge_chunk_status === "enabled"}
                          group="group"
                          onChange={(checked) =>
                            handleChunkStatusChange(
                              item.knowledge_chunk_id,
                              checked,
                            )
                          }
                        />
                        <div className="hidden items-center ml-2 group-hover:flex">
                          <Button
                            type="link"
                            className="hidden group-hover:inline-flex p-0"
                            onClick={() =>
                              handleEdit(item.knowledge_chunk_id, item.file_id)
                            }
                          >
                            <EditOutlined />
                            <span className="ml-1">{t("action.edit")}</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                    {item.isHighlight && (
                      <img
                        src={getPublicPath("/images/stamp.png")}
                        className="w-[84px] absolute right-[74px] -top-4"
                        alt="highlight"
                      />
                    )}
                    <div className="relative z-[1] h-[132px] mt-2 px-4 py-2">
                      <div className="h-full overflow-hidden">
                        <div className="text-sm text-regular whitespace-pre-wrap line-clamp-[5]">
                          {item.content}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
      <ChunkEditDrawer ref={chunkEditDrawerRef} file={file} />
    </div>
  );
}

export default LibraryRecallView;
