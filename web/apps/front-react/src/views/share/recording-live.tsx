/**
 * 录音分享落地页（实时分支，给移动端 Flutter WebView 嵌入用）
 *
 * 与 ShareRecordingView（快照分支）的对比：
 * - 快照分支：单次匿名 GET /api/recordings/shared/{shareId} 拿到预渲染快照
 * - 实时分支：URL 携带 fileId（外加可选 ?token=…），并发拉 5 个接口实时组装
 *   - GET /api/files/{fileId}（filesApi.get）
 *   - GET /api/recordings/files/{fileId}/parse-status（recordingApi.getParseStatus）
 *   - GET /api/recordings/files/{fileId}/transcription（recordingApi.getTranscription）
 *   - GET /api/recordings/files/{fileId}/summaries（recordingApi.getFileSummaries）
 *   - GET /api/recordings/files/{fileId}/insight-page（recordingApi.getInsightPage）
 *
 * token 注入：每个 axios 请求传 `{ params: { token } }`，
 * 由全局 axios 拦截器（api/config.ts）自动从 params 提取并写入 Authorization header。
 * 不写入 localStorage，避免污染登录态请求。
 *
 * 视觉完全复用 ShareRecordingView 的 export 视觉组件：
 * SnapshotHeader / SnapshotTabContent（固定走移动端样式，isMobileLayout 恒为 true），
 * 数据组装走 `./recording/buildTabState` 的 live 分支入口。
 *
 * 不渲染 TabsBar / MobileBottomBar：本页仅面向 Flutter WebView 全屏嵌入，
 * Tab 切换由 Flutter 宿主控制（postMessage 协议见下），分享走原生通道。
 * 外层容器对应去掉 snapshot 分支的 py-4（Flutter WebView 全屏嵌入，不需要垂直留白），
 * 内层 cardClass 移动端也去掉 pb-[68px]（无 MobileBottomBar，不需要底部留白）。
 *
 * Flutter 宿主 → H5 协议（单向，postMessage）：
 *   1) setAccessToken：注入分享鉴权 token（主路径；URL ?token=…
 *      在 WebView 跳转 / nginx fallback / 隐私扩展下经常被吃掉）
 *        webViewController.evaluateJavascript(
 *       source: "window.postMessage({type:'setAccessToken', token:'…'}, '*')"
 *     )
 *   2) switchTab：切换 tab
 *        webViewController.evaluateJavascript(
 *       source: "window.postMessage({type:'switchTab', tab:'insight'}, '*')"
 *     )
 *   H5 监听 window.message 事件，按 type 分发。
 *   协议字段：
 *     - type: 'setAccessToken' | 'switchTab'
 *     - token: string，setAccessToken 时携带
 *     - tab: 'insight' | 'summary' | 'transcript' | 'sum-<template_id>'，switchTab 时携带
 *   边界：
 *     - token 注入前 H5 保持 loading；URL ?token= 解析得到的 token 会作为初值
 *       被 Flutter 注入覆盖（Flutter token 永远更新鲜）
 *     - switchTab 时 H5 还在 loading（availableTabs 为空）消息被忽略
 *     - 非法字段直接忽略
 *
 * 错误处理：
 * - 必加载接口（file / parseStatus）失败 → 全局 `share.link_expired` 空态
 * - 可选接口（transcription / summaries / insightPage）失败 → 对应 tab 内容为空，tab 仍展示
 * - 401/403/404 全部归 share.link_expired 文案
 */
import { useEffect, useMemo, useState, lazy } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Empty, Button } from 'antd';
import recordingApi from '@/api/modules/recording';
import type {
  FileParseStatus,
  FileTranscriptionResponse,
  RecordingFileInsightPage,
  RecordingFileSummary,
  RecordingSharedContent,
} from '@/api/modules/recording/types';
import filesApi from '@/api/modules/files';
import type { RawFileItem } from '@/api/modules/files/types';
import { decodeRecordingSelection } from '@/views/recording/selection/shareSelection';
import { t } from '@/locales';
import { extractClosingQuote } from '@/views/recording/components/insightRenderer/markdownParser';
import {
  SnapshotHeader,
  SnapshotTabContent,
} from './recording';
import { type TabState, buildTabState, stripLastExtension, sumTabKey } from './recording/buildTabState';

const MarkdownViewer = lazy(() => import('@/components/FileViewer/MarkdownViewer'));

/**
 * 实时分支的 5 个接口结果容器 —— 失败时该字段为 null（不抛错），
 * 渲染层按需读 `data.*` + `errors.*` 决定全局空态 vs tab 级空态。
 */
interface LiveData {
  file: RawFileItem | null;
  parseStatus: FileParseStatus | null;
  transcription: FileTranscriptionResponse | null;
  summaries: RecordingFileSummary[];
  insightPage: RecordingFileInsightPage | null;
}

interface LiveErrors {
  file?: unknown;
  parseStatus?: unknown;
  transcription?: unknown;
  summaries?: unknown;
  insightPage?: unknown;
}

/**
 * 从 RawFileItem.path 中拆出最后一段作为 file_name。
 * path 形如 "/folder/audio.mp3" → "audio.mp3"。
 */
function extractFileNameFromPath(path: string | undefined | null): string {
  if (!path) return '';
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function ShareRecordingLiveView() {
  const { fileId = '' } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // access_token 注入路径（按优先级）：
  // 1. URL ?token=…  （部分场景可用，多数 WebView 跳转会丢 query）
  // 2. Flutter 宿主 window.postMessage({type:'setAccessToken', token:'…'})  （主路径）
  // 取到后存到 state + 写入 sessionStorage（share_token），让 axios 拦截器全局兜底读取，
  // 保证 layout 的 loadShortcuts/loadConversations 等共享接口也能用上鉴权；
  // 卸载时清理 sessionStorage，避免污染后续路由。
  const [accessToken, setAccessToken] = useState<string>(() => {
    const t = searchParams.get('token') || ''
    if (t && typeof sessionStorage !== 'undefined') sessionStorage.setItem('share_token', t)
    return t
  });

  // 卸载时清理 sessionStorage，防止 share_token 污染后续路由请求
  useEffect(() => {
    return () => {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('share_token')
    }
  }, [])

  // URL `?t=` 仍生效：分享者可勾选核心 tab（i/s/t）与模板总结 sums
  const selection = useMemo(
    () => decodeRecordingSelection(searchParams),
    [searchParams],
  );

  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [data, setData] = useState<LiveData>({
    file: null,
    parseStatus: null,
    transcription: null,
    summaries: [],
    insightPage: null,
  });
  const [errors, setErrors] = useState<LiveErrors>({});

  // 进入页面就开始预加载 MarkdownViewer。sum-* tab 用它渲染，不预加载的话
  // 首次切到 sum-* tab 时 Suspense fallback（小 Spin）会闪一下。
  useEffect(() => {
    import('@/components/FileViewer/MarkdownViewer').catch(() => {})
  }, [])

  // 挂载 + fileId / accessToken 变化时并发拉 5 个接口
  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      setGlobalError(t('share.link_expired'));
      return;
    }
    if (!accessToken) {
      // token 还没注入（Flutter 宿主尚未 postMessage），保持 loading 等待
      return;
    }

    let cancelled = false;
    setLoading(true);
    setGlobalError(null);
    setData({
      file: null,
      parseStatus: null,
      transcription: null,
      summaries: [],
      insightPage: null,
    });
    setErrors({});

    // axios 拦截器从 config.params.token 提取 token → Authorization header；
    // 也兜底从 sessionStorage.share_token 读取（main.tsx 启动时 / 上一轮 setAccessToken 已写入）
    const tokenConfig = { params: { token: accessToken } };

    Promise.allSettled([
      filesApi.get(fileId, tokenConfig),
      recordingApi.getParseStatus(fileId, tokenConfig),
      recordingApi.getTranscription(fileId, tokenConfig),
      recordingApi.getFileSummaries(fileId, tokenConfig),
      recordingApi.getInsightPage(fileId, tokenConfig),
    ]).then((results) => {
      if (cancelled) return;
      const [fileR, parseR, transR, sumsR, insightR] = results;
      const newData: LiveData = {
        file: fileR.status === 'fulfilled' ? fileR.value : null,
        parseStatus: parseR.status === 'fulfilled' ? parseR.value : null,
        transcription: transR.status === 'fulfilled' ? transR.value : null,
        summaries: sumsR.status === 'fulfilled' ? sumsR.value : [],
        insightPage: insightR.status === 'fulfilled' ? insightR.value : null,
      };
      const newErrors: LiveErrors = {
        file: fileR.status === 'rejected' ? fileR.reason : undefined,
        parseStatus: parseR.status === 'rejected' ? parseR.reason : undefined,
        transcription: transR.status === 'rejected' ? transR.reason : undefined,
        summaries: sumsR.status === 'rejected' ? sumsR.reason : undefined,
        insightPage: insightR.status === 'rejected' ? insightR.reason : undefined,
      };
      // 任一必加载接口失败 / 返回 null → 全局空态
      if (!newData.file || !newData.parseStatus) {
        // eslint-disable-next-line no-console
        console.error('[ShareRecordingLiveView] 必加载接口失败', {
          fileError: newErrors.file,
          parseStatusError: newErrors.parseStatus,
        });
        setGlobalError(t('share.link_expired'));
      } else {
        // 可选接口失败仅记日志，渲染层走 tab 级空态
        Object.entries(newErrors).forEach(([key, err]) => {
          if (err && (key === 'transcription' || key === 'summaries' || key === 'insightPage')) {
            // eslint-disable-next-line no-console
            console.warn(`[ShareRecordingLiveView] 可选接口 ${key} 失败`, err);
          }
        });
      }
      setData(newData);
      setErrors(newErrors);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [fileId, accessToken]);

  // 5 个接口都拿到后才组装 tabState；tabState 为 null 时渲染层显示全局空态
  const tabState = useMemo<TabState | null>(() => {
    if (!data.file || !data.parseStatus) return null;
    return buildTabState({
      kind: 'live',
      file: data.file,
      parseStatus: data.parseStatus,
      transcription: data.transcription,
      summaries: data.summaries,
      insightPage: data.insightPage,
      selection,
    });
  }, [data, selection]);

  // tab 顺序：洞察 → 纪要 → 转写 → sum-*（仅保留有内容的 tab）
  const availableTabs = useMemo(() => {
    if (!tabState) return [];
    const tabs: Array<{ key: string; label: string; icon: string }> = [];
    if (tabState.hasInsight) tabs.push({ key: 'insight', label: t('recording.tab.insight'), icon: 'doc-search' });
    if (tabState.hasSummary) tabs.push({ key: 'summary', label: t('recording.tab.summary'), icon: 'notebook-one' });
    if (tabState.hasTranscript) tabs.push({ key: 'transcript', label: t('recording.tab.transcript'), icon: 'doc-success' });
    tabState.templateSummaries.forEach((s) => {
      tabs.push({ key: sumTabKey(s.id), label: s.template_name || t('recording.tab.template_default'), icon: 'notes' });
    });
    return tabs;
  }, [tabState]);

  const [activeTab, setActiveTab] = useState('insight');
  useEffect(() => {
    if (availableTabs.length === 0) return;
    if (!availableTabs.some((t) => t.key === activeTab)) {
      setActiveTab(availableTabs[0].key);
    }
  }, [availableTabs, activeTab]);

  // 监听 Flutter 宿主发来的消息
  // 协议见文件头部注释：
  //   - { type: 'setAccessToken', token: '…' }  → 写入 accessToken state
  //   - { type: 'switchTab', tab: 'insight'|'summary'|'transcript'|'sum-<id>' }  → 切 tab
  // 非法字段直接忽略
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'setAccessToken' && typeof data.token === 'string') {
        setAccessToken(data.token);
        // Flutter 注入的 token 也写入 sessionStorage，让所有 axios 请求都能用
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('share_token', data.token);
        return;
      }
      if (data.type === 'switchTab' && typeof data.tab === 'string') {
        if (!availableTabs.some((t) => t.key === data.tab)) return;
        setActiveTab(data.tab);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [availableTabs]);

  // 同步 document.title：live 分支无分享人概念，昵称留空
  useEffect(() => {
    if (!data.file) return;
    const previousTitle = document.title;
    document.title = t('share.recording_document_title', { nickname: '' });
    return () => {
      document.title = previousTitle;
    };
  }, [data.file]);

  // 同步 <meta name="description">：录音标题 + 洞察末尾引用
  useEffect(() => {
    if (!data.file) return;
    const rawTitle = extractFileNameFromPath(data.file.path);
    const title = rawTitle ? stripLastExtension(rawTitle) : t('recording.default_name');
    const markdown = tabState?.insightPage?._markdown as string | undefined;
    const quote = markdown ? (extractClosingQuote(markdown)?.quote ?? '') : '';
    const description = quote ? `${title}。${quote}` : title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const previous = meta.getAttribute('content') ?? '';
    meta.setAttribute('content', description);
    return () => {
      meta.setAttribute('content', previous);
    };
  }, [data.file, tabState]);

  // 移动端布局：Flutter WebView 全屏嵌入，始终走移动端样式，不做 PC 分支
  const cardClass = 'flex flex-col w-full h-full rounded-none bg-[#F1F4FB]';
  const headerClass = 'h-20 px-4';
  const contentPaddingClass = 'px-4';

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#F1F4FB]">
        <Spin size="large" />
      </div>
    );
  }

  if (globalError || !data.file) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-[#F1F4FB]">
        <Empty description={globalError || t('share.link_expired')} />
        <Button type="primary" onClick={() => navigate('/')}>
          {t('common.back_home')}
        </Button>
      </div>
    );
  }

  /**
   * 构造"虚拟 snapshot"对象喂给 SnapshotHeader。
   *
   * SnapshotHeader 的 props 类型是 RecordingSharedContent，live 分支没有完整快照；
   * 这里只喂 SnapshotHeader 实际读取的字段（title / created_time），
   * 其余字段置空。类型断言是因为 RecordingSharedContent 还含 file_id 等必填字段，
   * 但 SnapshotHeader 不会读到，所以这里用 `as unknown as` 一次性绕开。
   * live 分支没有"分享人"概念，nickname 留空；移动端不渲染头像；
   * created_time 走文件的更新时间（RawFileItem.updated_time），文案「更新时间」。
   */
  const rawTitle = extractFileNameFromPath(data.file.path);
  const virtualSnapshot = {
    file_id: String(data.file.id),
    title: rawTitle,
    nickname: undefined,
    created_time: data.file.updated_time,
  } as unknown as RecordingSharedContent;

  return (
    <div className="h-full flex flex-col bg-[#F1F4FB] overflow-y-auto">
      <div className={`m-auto  ${cardClass}`}>
        <SnapshotHeader
          snapshot={virtualSnapshot}
          headerClass={headerClass}
          isMobileLayout
          timeLabelKey="common.updated_time_form"
        />
        {availableTabs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Empty description={t('share.no_content')} />
          </div>
        ) : (
          <>
            {tabState && <SnapshotTabContent activeTab={activeTab} scrollable={false} tabState={tabState} contentPadding={contentPaddingClass} />}
          </>
        )}
      </div>
    </div>
  );
}

export default ShareRecordingLiveView;