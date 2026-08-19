import { lazy, Suspense, useEffect, useMemo } from 'react';
import {
  createBrowserRouter,
  createHashRouter,
  Navigate,
  Outlet,
  useLocation, useBlocker
} from "react-router-dom";
import {
  useEnterpriseStore,
  useIsSoftStyle,
} from "@/stores/modules/enterprise";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useUserStore } from "@/stores/modules/user";
import {
  includeKm,
  NAVIGATION_TYPE,
  NAVIGATION_TARGET,
} from "@/constants/navigation";
import { handleChunkLoadError } from "@km/shared-utils";
import { InitGuard } from "@/components/InitGuard";
import { checkVersion } from "@/utils/version";
import { isOpLocalEnv, isPrivatePrem } from '@/utils/config';
import { VERSION_MODULE } from "@/constants/enterprise";
import { useRecordingStore } from "@/stores/modules/recording";

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  )
}

// Helper to create lazy component with Suspense
function lazyWithSuspense<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
) {
  const LazyComponent = lazy(() =>
    importFn().catch((error) => {
      // 确保 error 是 Error 对象
      const err = error instanceof Error ? error : new Error(String(error))
      if (handleChunkLoadError(err)) {
        // 返回一个永远 pending 的 Promise，阻止后续渲染
        return new Promise(() => {}) as Promise<{ default: T }>
      }
      throw error
    })
  )
  return function SuspenseWrapper(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    )
  }
}

// Lazy load views
const Layout = lazyWithSuspense(() => import('@/views/layout').then((m) => ({ default: m.Layout })))
const IndexView = lazyWithSuspense(() =>
  import('@/views/index/index').then((m) => ({ default: m.IndexView }))
)

const LibraryChatView = lazyWithSuspense(() =>
  import('@/views/chat/LibraryChatView').then((m) => ({
    default: m.LibraryChatView
  }))
)
const IndexLayout = lazyWithSuspense(() =>
  import('@/views/index/IndexLayout').then((m) => ({
    default: m.IndexLayout
  }))
)
// 使用 shared-business 组件
const ChatView = lazyWithSuspense(() =>
  import('@/views/chat/index').then((m) => ({ default: m.default }))
)
const PortalView = lazyWithSuspense(() =>
  import('@/views/portal').then((m) => ({ default: m.PortalView }))
)
const AgentView = lazyWithSuspense(() =>
  import('@/views/agent').then((m) => ({ default: m.default }))
)
const AgentCreateV2View = lazyWithSuspense(() =>
  import('@/views/agent/create-v2').then((m) => ({ default: m.AgentCreateV2 }))
)
const AgentDetailView = lazyWithSuspense(() =>
  import('@/views/agent/detail').then((m) => ({ default: m.AgentDetailView }))
)
const PromptView = lazyWithSuspense(() =>
  import('@/views/prompt').then((m) => ({ default: m.PromptView }))
)
const PromptDetailView = lazyWithSuspense(() =>
  import('@/views/prompt/detail').then((m) => ({
    default: m.PromptDetailView
  }))
)
const ToolkitView = lazyWithSuspense(() =>
  import('@/views/toolkit').then((m) => ({ default: m.ToolkitView }))
)
const SkillsView = lazyWithSuspense(() =>
  import('@/views/skills').then((m) => ({ default: m.default }))
)
const SkillDetailView = lazyWithSuspense(() =>
  import('@/views/skills/detail').then((m) => ({ default: m.default }))
)
const KnowledgeView = lazyWithSuspense(() =>
  import('@/views/knowledge').then((m) => ({ default: m.KnowledgeView }))
)
const WikiView = lazyWithSuspense(() =>
  import('@/views/knowledge/wiki/WikiView').then((m) => ({ default: m.WikiView }))
)
const MineView = lazyWithSuspense(() =>
  import("@/views/mine").then((m) => ({ default: m.MineView })),
);

const ProfileView = lazyWithSuspense(() =>
  import('@/views/profile/userInfo').then((m) => ({ default: m.ProfileView }))
)
const OrderView = lazyWithSuspense(() =>
  import('@/views/order').then((m) => ({ default: m.OrderView }))
)
const ShareChatView = lazyWithSuspense(() =>
  import('@/views/share/chat').then((m) => ({ default: m.ShareChatView }))
)
const ShareFileView = lazyWithSuspense(() =>
  import('@/views/share/file').then((m) => ({ default: m.ShareFileView }))
)

const GuideView = lazyWithSuspense(() =>
  import('@/views/guide').then((m) => ({ default: m.GuideView }))
)
const SvgListView = lazyWithSuspense(() =>
  import('@/views/svglist').then((m) => ({ default: m.SvgListView }))
)
const Error500View = lazyWithSuspense(() =>
  import('@/views/exception/500').then((m) => ({ default: m.Error500View }))
)
const SsoLoginView = lazyWithSuspense(() =>
  import('@/views/index/apilogin').then((m) => ({ default: m.SsoLoginView }))
)
const WebView = lazyWithSuspense(() =>
  import('@/views/custom/iframe').then((m) => ({ default: m.WebView }))
)
const CustomView = lazyWithSuspense(() =>
  import('@/views/custom').then((m) => ({ default: m.CustomView }))
)

// Library views
const LibraryMainView = lazyWithSuspense(() =>
  import('@/views/library/main').then((m) => ({ default: m.LibraryMainView }))
)
const LibraryHomeView = lazyWithSuspense(() =>
  import('@/views/library/main/home').then((m) => ({
    default: m.LibraryHomeView
  }))
)
const LibraryFileLayout = lazyWithSuspense(() =>
  import('@/views/library/main/file/layout').then((m) => ({
    default: m.LibraryFileLayout
  }))
)
const LibraryFileView = lazyWithSuspense(() =>
  import('@/views/library/main/file').then((m) => ({
    default: m.LibraryFileView
  }))
)
const LibraryFileSourceEdit = lazyWithSuspense(() =>
  import('@/views/library/main/file/source-edit').then((m) => ({
    default: m.default
  }))
)
const LibraryFileChunks = lazyWithSuspense(() =>
  import('@/views/library/main/file/chunks.v2').then((m) => ({
    default: m.default
  }))
)
const LibraryFileChunksEdit = lazyWithSuspense(() =>
  import('@/views/library/main/file/chunks-edit').then((m) => ({
    default: m.default
  }))
)
const LibraryFolderView = lazyWithSuspense(() =>
  import('@/views/library/main/folder').then((m) => ({
    default: m.LibraryFolderView
  }))
)
const LibraryRecallView = lazyWithSuspense(() =>
  import('@/views/library/main/recall').then((m) => ({
    default: m.LibraryRecallView
  }))
)
const LibraryGraphView = lazyWithSuspense(() =>
  import('@/views/library/main/graph').then((m) => ({
    default: m.LibraryGraphView
  }))
)
const LibrarySettingLayout = lazyWithSuspense(() =>
  import('@/views/library/setting').then((m) => ({
    default: m.LibrarySettingLayout
  }))
)
const LibrarySettingInfo = lazyWithSuspense(() =>
  import('@/views/library/setting/info').then((m) => ({
    default: m.default
  }))
)
const LibrarySettingApi = lazyWithSuspense(() =>
  import('@/views/library/setting/api').then((m) => ({
    default: m.LibraryApiSettingsView
  }))
)
const LibrarySettingPermission = lazyWithSuspense(() =>
  import('@/views/library/setting/permission').then((m) => ({
    default: m.LibraryPermissionSettingsView
  }))
)
const LibrarySettingRecycle = lazyWithSuspense(() =>
  import('@/views/library/setting/recycle').then((m) => ({
    default: m.LibraryRecycleSettingsView
  }))
)
const LibrarySettingChunk = lazyWithSuspense(() =>
  import('@/views/library/setting/chunk').then((m) => ({
    default: m.LibraryChunkSettingsView
  }))
)
const LibrarySettingDocument = lazyWithSuspense(() =>
  import('@/views/library/setting/document-setting').then((m) => ({
    default: m.LibraryDocumentSettingsView
  }))
)
const LibrarySettingEmbedded = lazyWithSuspense(() =>
  import('@/views/library/setting/embedded').then((m) => ({
    default: m.LibraryEmbeddedSettingsView
  }))
)

// 把 pathname+search+hash 序列化成相对 URL，供 ?redirect= 使用
function locationToPath(location: { pathname: string; search: string; hash: string }): string {
  return `${location.pathname}${location.search}${location.hash}`
}

// 校验 ?redirect= 是否为同源相对路径，防止开放重定向攻击。
// 必须以单个 / 开头、不能以 // 开头（协议相对 URL）、不能包含 :// 或 \\（绝对 URL / 路径穿越）。
// AuthBlocker 写入 sessionStorage 的目标来自 blocker.location，本身就安全，无需校验。
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.includes('://') || value.includes('\\')) return null
  return value
}

// 当 PermissionGuard 把用户跳到 / 时，会带上 ?redirect=<原 URL>。
// 但 / 是 index 路由，会触发 RootRedirect / IndexComponent 再次跳走。
// 这里把 ?redirect= 透传到下一次跳转的目标，让 layout.tsx 在登录成功后仍能拿到。
export function withPreservedRedirect(
  to: string,
  currentSearch: string,
  currentHash: string = '',
): string {
  const redirect = new URLSearchParams(currentSearch).get('redirect')
  if (!redirect) return to
  const params = new URLSearchParams({ redirect })
  // 保留目标 URL 上原有的其他 query 参数
  const target = new URL(to, 'http://placeholder')
  target.searchParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value)
  })
  // currentHash 是外层 URL 上的 hash(锚点定位),而 target.hash 来自 to 字符串,
  // 调用方传入的硬编码路径不带 hash,所以必须用 currentHash 才能保留锚点。
  return `${target.pathname}?${params.toString()}${currentHash}`
}

// 需要登录认证的路径匹配规则
const AUTH_REQUIRED_PATTERNS = [
  /^\/skills\/[^/]+$/, // /skills/:skill_id
  /^\/prompt\/[^/]+$/ // /prompt/:prompt_id
]

// 检查路径是否需要认证
function requiresAuth(pathname: string): boolean {
  return AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(pathname))
}

// 拦截未登录用户访问需要认证的路由
function AuthBlocker({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const token = localStorage.getItem('access_token')
    return !token && requiresAuth(nextLocation.pathname) && !requiresAuth(currentLocation.pathname)
  })

  useEffect(() => {
    if (blocker.state === 'blocked') {
      // 应用内跳转场景下用户停留在原页面，无法用 URL 参数传递目标地址，
      // 因此用 sessionStorage 暂存，登录成功后由 layout.tsx 取出并跳转。
      const target = locationToPath(blocker.location)
      try {
        sessionStorage.setItem('login_redirect', target)
      } catch {
        // sessionStorage 不可用时静默忽略
      }
      blocker.reset()
      window.dispatchEvent(new CustomEvent('open-login-modal'))
    }
  }, [blocker])

  // 用户主动离开被拦截的目标路径后，sessionStorage 中保存的 redirect 已过期，
  // 必须清掉，否则用户之后通过 header 登录时会被错误地重定向回那个旧目标。
  // 例如：拦截 /skills/abc → 用户放弃登录并导航到 /portal → 通过 header 登录 → 不应再去 /skills/abc
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('login_redirect')
      if (stored && stored !== locationToPath(location)) {
        sessionStorage.removeItem('login_redirect')
      }
    } catch {
      // sessionStorage 不可用时静默忽略
    }
  }, [location.pathname, location.search, location.hash])

  return <>{children}</>
}

// Route guard for checking permissions
// 只处理直接地址栏访问/刷新的情况，应用内导航由 AuthBlocker 拦截
function PermissionGuard({ children, auth }: { children: React.ReactNode; auth?: boolean }) {
  const token = localStorage.getItem('access_token')
  const location = useLocation()
  const needsLogin = auth && !token

  // Dispatch login modal event in useEffect to avoid setState during render
  useEffect(() => {
    if (needsLogin) {
      window.dispatchEvent(new CustomEvent('open-login-modal'))
    }
  }, [needsLogin])

  if (needsLogin) {
    const redirectTarget = encodeURIComponent(locationToPath(location))
    return <Navigate to={`/?redirect=${redirectTarget}`} replace />
  }

  return <>{children}</>
}

/** 录音路由守卫：recordingConfig.enabled 为 false 时重定向到首页 */
function RecordingGuard({ children }: { children: React.ReactNode }) {
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)

  // 配置尚未加载完成，先不渲染
  if (recordingConfig === null) return null

  if (recordingConfig.enabled === false) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function useVisibleNavigations() {
  const isSoftStyle = useIsSoftStyle()
  const navigations = useNavigationStore((state) => state.navigations)
  const userStore = useUserStore()

  return useMemo(() => {
    return navigations
      .filter((item) => +item.status)
      .filter((item) => (item.jump_path === '/knowledge' ? userStore.info.is_internal : true))
      .filter((item) => {
        // 软件模式下不展示首页（无论版本如何）
        if (isSoftStyle && item.jump_path === '/index') return false
        // /skills 在两种模式下都需要检查 WORKBENCH 版本
        return item.jump_path === '/skills' ? checkVersion(VERSION_MODULE.WORKBENCH) : true
      })
      .filter((item) => item.jump_path !== '/___placeholder')
  }, [isSoftStyle, navigations, userStore.info.is_internal])
}

function RootRedirect() {
  const visibleNavigations = useVisibleNavigations()
  const isSoftStyle = useIsSoftStyle()
  const firstNav = visibleNavigations[0]
  const location = useLocation()

  if (!firstNav) {
    // 软件模式下首页不可达，fallback 直接走 /agent，避免 /index → /agent 的二次跳转
    return (
      <Navigate
        to={withPreservedRedirect(
          isSoftStyle ? '/agent' : '/index',
          location.search,
          location.hash,
        )}
        replace
      />
    )
  }

  return (
    <Navigate
      to={withPreservedRedirect(firstNav.jump_path, location.search, location.hash)}
      replace
    />
  )
}

// Dynamic component for index
function IndexComponent() {
  const isSoftStyle = useIsSoftStyle()
  const location = useLocation()

  // 软件模式下访问 /index 重定向到 /agent
  if (isSoftStyle) {
    return (
      <Navigate
        to={withPreservedRedirect('/agent', location.search, location.hash)}
        replace
      />
    )
  }
  return <IndexView />
}

function AgentComponent() {
  const isSoftStyle = useIsSoftStyle()
  if (isSoftStyle) {
    return <IndexLayout />
  }
  return <AgentView />
}

// /agent 的 index 路由：跳到 ./agent（即 /agent/agent），必须显式透传 search/hash，
// 否则 PermissionGuard 写入的 ?redirect=<原URL> 会在这一步被相对路径 Navigate 丢掉。
function AgentIndexRedirect() {
  const location = useLocation()
  return (
    <Navigate to={{ pathname: './agent', search: location.search, hash: location.hash }} replace />
  )
}

// Dynamic component for knowledge route
function KnowledgeComponent() {
  const isSoftStyle = useIsSoftStyle()
  return isSoftStyle ? <KnowledgeView /> : <KnowledgeView />
}

// Dynamic custom page handler
function DynamicCustomPage() {
  const location = useLocation()
  const navigations = useNavigationStore((state) => state.navigations)
  const pathname = location.pathname

  // 查找匹配的自定义导航
  const customNav = navigations.find((item) => {
    if (item.menu_path === pathname || item.jump_path === pathname) {
      return (
        item.type === NAVIGATION_TYPE.CUSTOM ||
        (item.type === NAVIGATION_TYPE.EXTERNAL && item.target === NAVIGATION_TARGET.SELF)
      )
    }
    return false
  })

  if (!customNav) {
    return <Navigate to="/" replace />
  }

  // 如果是外部链接且 target 为 SELF，使用 WebView
  const isExternal =
    customNav.type === NAVIGATION_TYPE.EXTERNAL && customNav.target === NAVIGATION_TARGET.SELF

  if (isExternal) {
    return <WebView jumpPath={customNav.jump_path} />
  }

  return <CustomView title={customNav.name} />
}

// Build routes
const buildRoutes = () => {
  const routes = [
    {
      element: (
        <InitGuard>
          <AuthBlocker>
            <Outlet />
          </AuthBlocker>
        </InitGuard>
      ),
      children: [
        {
          path: '/',
          element: <Layout />,
          children: [
            {
              index: true,
              element: <RootRedirect />
            },
            {
              path: 'index',
              element: <IndexComponent />
            },
            {
              path: 'index/apilogin',
              element: <SsoLoginView />
            },
            {
              path: 'agent',
              element: <AgentComponent />,
              handle: { banner: true },
              children: [
                {
                  index: true,
                  element: <AgentIndexRedirect />
                },
                { path: 'agent', element: <ChatView /> }
              ]
            },
            {
              path: 'agent/create-v2',
              element: <AgentCreateV2View />
            },
            {
              path: 'agent/:agent_id',
              element: <AgentDetailView />
            },
            {
              path: 'chat',
              element: <ChatView />
            },
            {
              path: 'portal',
              element: <PortalView />
            },
            {
              path: 'toolkit',
              element: <ToolkitView />,
              handle: { banner: true }
            },
            {
              path: 'skills',
              element: <SkillsView />,
              handle: { banner: true }
            },
            {
              path: 'skills/:skill_id',
              element: <SkillDetailView />
            },
            {
              path: 'prompt',
              element: <PromptView />,
              handle: { banner: true }
            },
            {
              path: 'prompt/:prompt_id',
              element: <PromptDetailView />
            },
            ...(includeKm
              ? [
                  {
                    path: 'knowledge',
                    element: (
                      <PermissionGuard auth>
                        <KnowledgeComponent />
                      </PermissionGuard>
                    ),
                    handle: { banner: true },
                    children: [
                      {
                        path: ':space_id',
                        element: <KnowledgeComponent />,
                        handle: { banner: true }
                      }
                    ]
                  },
                  {
                    path: 'knowledge/wiki',
                    element: (
                      <PermissionGuard auth>
                        <WikiView />
                      </PermissionGuard>
                    ),
                    handle: { banner: true }
                  }
                ]
              : []),
            {
              path: 'order',
              element: (
                <PermissionGuard auth>
                  <OrderView />
                </PermissionGuard>
              )
            },
            {
              path: "mine",
              element: (
                <PermissionGuard auth>
                  <MineView />
                </PermissionGuard>
              )
            },
            {
              path: 'profile',
              element: (
                <PermissionGuard auth>
                  <ProfileView />
                </PermissionGuard>
              )
            },
            {
              path: 'webview',
              element: <WebView />
            },
            ...(includeKm
              ? [
                  {
                    path: "library/:id",
                    element: (
                      <PermissionGuard auth>
                        <Outlet />
                      </PermissionGuard>
                    ),
                    children: [
                      {
                        path: "",
                        element: <LibraryMainView />,
                        children: [
                          { index: true, element: <LibraryHomeView /> },
                          { path: "chat", element: <LibraryChatView /> },
                          {
                            path: "file/:fid",
                            element: <LibraryFileLayout />,
                            children: [
                              { index: true, element: <LibraryFileView /> },
                              {
                                path: "source-edit",
                                element: <LibraryFileSourceEdit />,
                              },
                              { path: "chunks", element: <LibraryFileChunks /> },
                            ],
                          },
                          {
                            path: "file/:fid/chunks-edit",
                            element: <LibraryFileChunksEdit />,
                          },
                          { path: "folder/:fid", element: <LibraryFolderView /> },
                          { path: "recall", element: <LibraryRecallView /> },
                          { path: "graph", element: <LibraryGraphView /> },
                        ],
                      },
                      {
                        path: "setting",
                        element: <LibrarySettingLayout />,
                        children: [
                          { index: true, element: <Navigate to="info" replace /> },
                          { path: "info", element: <LibrarySettingInfo /> },
                          { path: "permission", element: <LibrarySettingPermission /> },
                          { path: "api", element: <LibrarySettingApi /> },
                          { path: "recycle", element: <LibrarySettingRecycle /> },
                          { path: "chunk", element: <LibrarySettingChunk /> },
                          {
                            path: "document-setting",
                            element: <LibrarySettingDocument />,
                          },
                          { path: "embedded", element: <LibrarySettingEmbedded /> },
                        ],
                      },
                    ],
                  },
                ]
              : []),
            // Dynamic custom page route - must be before the catch-all route
            {
              path: ':customPath',
              element: <DynamicCustomPage />
            }
          ]
        },
        ...(includeKm
          ? [
              {
                path: '/library/:id',
                element: (
                  <PermissionGuard auth>
                    <Outlet />
                  </PermissionGuard>
                ),
                children: [
                  {
                    path: '',
                    element: <LibraryMainView />,
                    children: [
                      { index: true, element: <LibraryHomeView /> },
                      { path: 'chat', element: <LibraryChatView /> },
                      {
                        path: 'file/:fid',
                        element: <LibraryFileLayout />,
                        children: [
                          { index: true, element: <LibraryFileView /> },
                          {
                            path: 'source-edit',
                            element: <LibraryFileSourceEdit />
                          },
                          { path: 'chunks', element: <LibraryFileChunks /> }
                        ]
                      },
                      {
                        path: 'file/:fid/chunks-edit',
                        element: <LibraryFileChunksEdit />
                      },
                      { path: 'folder/:fid', element: <LibraryFolderView /> },
                      { path: 'recall', element: <LibraryRecallView /> },
                      { path: 'graph', element: <LibraryGraphView /> }
                    ]
                  },
                  {
                    path: 'setting',
                    element: <LibrarySettingLayout />,
                    children: [
                      { index: true, element: <Navigate to="info" replace /> },
                      { path: 'info', element: <LibrarySettingInfo /> },
                      { path: 'permission', element: <LibrarySettingPermission /> },
                      { path: 'api', element: <LibrarySettingApi /> },
                      { path: 'recycle', element: <LibrarySettingRecycle /> },
                      { path: 'chunk', element: <LibrarySettingChunk /> },
                      {
                        path: 'document-setting',
                        element: <LibrarySettingDocument />
                      },
                      { path: 'embedded', element: <LibrarySettingEmbedded /> }
                    ]
                  }
                ]
              }
            ]
          : []),
        {
          path: '/share/chat',
          element: <ShareChatView />
        },
        {
          path: '/share/file/:id',
          element: (
            <PermissionGuard auth>
              <ShareFileView />
            </PermissionGuard>
          )
        },
        {
          path: '/guide',
          element: <GuideView />
        },
        {
          path: '/svglist',
          element: <SvgListView />
        },
        {
          path: '/500',
          element: <Error500View />
        },
        {
          path: '*',
          element: <Navigate to="/" replace />
        }
      ]
    }
  ]

  return routes
}

const useHashRouter = isOpLocalEnv || isPrivatePrem;

export const isHashRouter = useHashRouter
export const isHistoryRouter = !useHashRouter

/**
 * 获取当前路由路径（兼容 HashRouter 和 BrowserRouter）
 *
 * ⚠️ 重要：在非 React 组件中（如 store、utils）必须使用此函数
 * 在 React 组件中应使用 useLocation().pathname
 *
 * @returns 当前路由路径，如 "/library/123/file/456"
 */
export function getCurrentPathname(): string {
  if (useHashRouter) {
    // HashRouter: hash 格式为 "#/path"，需要去掉 "#"
    const hash = window.location.hash
    return hash ? hash.slice(1) || '/' : '/'
  }
  // BrowserRouter: pathname 直接是路径
  return window.location.pathname || '/'
}

/**
 * 检查当前路径是否包含指定路径段（兼容 HashRouter 和 BrowserRouter）
 *
 * ⚠️ 重要：在非 React 组件中（如 store、utils）必须使用此函数
 * 在 React 组件中应使用 useLocation().pathname
 *
 * @param pathSegment - 要检查的路径段，如 "/chat"
 * @returns 是否包含该路径段
 */
export function pathIncludes(pathSegment: string): boolean {
  return getCurrentPathname().includes(pathSegment)
}

/**
 * 获取完整的基础路径（用于构建静态资源 URL，兼容两种路由模式）
 *
 * 在 HashRouter 模式下，pathname 是基础路径（如 "/app/" 或 "/"）
 * 在 BrowserRouter 模式下，pathname 是完整路由路径
 *
 * @returns 基础路径，如 "/app" 或 "/"
 */
export function getBasePath(): string {
  if (useHashRouter) {
    // HashRouter: pathname 是基础路径，hash 包含路由
    return window.location.pathname.replace(/\/$/, '') || ''
  }
  // BrowserRouter: pathname 就是路由路径
  return ''
}

// Create router
export const router = useHashRouter
  ? createHashRouter(buildRoutes())
  : createBrowserRouter(buildRoutes())

// Setup router function
export async function setupRouter() {
  // Load enterprise info before routing
  const enterpriseStore = useEnterpriseStore.getState()
  await enterpriseStore.loadInfo()
  await enterpriseStore.loadSaasInfo()

  // Load navigation
  const navigationStore = useNavigationStore.getState()
  await navigationStore.fetchNavigations()
}
