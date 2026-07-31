import { Suspense, lazy } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { LayoutShell } from "@/layout/Layout";
import { RequireAuth } from "./guards";
import { handleChunkLoadError } from "@km/shared-utils";

// 页面加载中的 Loading 组件
const PageLoading = () => (
  <div className="w-full h-full flex items-center justify-center">
    <Spin size="large" />
  </div>
);

// 包装 lazy 组件，添加 chunk 错误处理
function lazyWithCatch<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (handleChunkLoadError(err)) {
        // 返回一个永远 pending 的 Promise，阻止后续渲染
        return new Promise(() => {}) as Promise<{ default: T }>;
      }
      throw error;
    }),
  );
}

// 懒加载页面组件 - 减少首屏 JS 体积
const RegisterForm = lazyWithCatch(() =>
  import("@/views/login/components/RegisterForm").then((m) => ({
    default: m.RegisterForm,
  })),
);
const ApplyForm = lazyWithCatch(() =>
  import("@/views/login/components/ApplyForm").then((m) => ({
    default: m.ApplyForm,
  })),
);
const HomePage = lazyWithCatch(() =>
  import("@/views/index/index").then((m) => ({ default: m.HomePage })),
);
const InfoPage = lazyWithCatch(() =>
  import("@/views/info/index").then((m) => ({ default: m.InfoPage })),
);
const ConfigPage = lazyWithCatch(() =>
  import("@/views/config/index").then((m) => ({ default: m.ConfigPage })),
);
const SystemLogRefactoredPage = lazy(() =>
  import("@/views/system-log-refactored/index").then((m) => ({
    default: m.SystemLogRefactoredPage,
  })),
);
const ToolboxRefactoredPage = lazyWithCatch(() =>
  import("@/views/toolbox-refactored/index").then((m) => ({
    default: m.ToolboxRefactoredPage,
  })),
);
const ToolkitCreatePage = lazyWithCatch(() =>
  import("@/views/toolbox-refactored/create/index").then((m) => ({
    default: m.ToolboxCreatePage,
  })),
);
const SMTPPage = lazyWithCatch(() =>
  import("@/views/smtp/index").then((m) => ({ default: m.SMTPPage })),
);
const DomainPage = lazyWithCatch(() =>
  import("@/views/domain/index").then((m) => ({ default: m.DomainPage })),
);
const NavigationPage = lazyWithCatch(() =>
  import("@/views/navigation/index").then((m) => ({
    default: m.NavigationPage,
  })),
);
const WebSettingPage = lazyWithCatch(() =>
  import("@/views/navigation/WebSetting").then((m) => ({
    default: m.WebSettingPage,
  })),
);
const OrderPage = lazyWithCatch(() =>
  import("@/views/order/index").then((m) => ({ default: m.OrderPage })),
);
const PaymentPage = lazyWithCatch(() =>
  import("@/views/payment/index").then((m) => ({ default: m.PaymentPage })),
);
const StatisticsPage = lazyWithCatch(() =>
  import("@/views/statistics/index").then((m) => ({
    default: m.StatisticsPage,
  })),
);
const SubscriptionPage = lazyWithCatch(() =>
  import("@/views/subscription/index").then((m) => ({
    default: m.SubscriptionPage,
  })),
);
const KnowledgePage = lazyWithCatch(() =>
  import("@/views/knowledge/index").then((m) => ({ default: m.KnowledgePage })),
);
const PromptPage = lazyWithCatch(() =>
  import("@/views/prompt/index").then((m) => ({ default: m.PromptPage })),
);
const PromptCreatePage = lazyWithCatch(() =>
  import("@/views/prompt/create/index").then((m) => ({
    default: m.PromptCreatePage,
  })),
);
const SearchPage = lazyWithCatch(() =>
  import("@/views/search/index").then((m) => ({ default: m.SearchPage })),
);
const PlatformPage = lazyWithCatch(() =>
  import("@/views/platform/index").then((m) => ({ default: m.PlatformPage })),
);
const UserAdminPage = lazyWithCatch(() =>
  import("@/views/user/admin/index").then((m) => ({
    default: m.UserAdminPage,
  })),
);
const UserInternalPage = lazyWithCatch(() =>
  import("@/views/user/internal/index").then((m) => ({
    default: m.UserInternalPage,
  })),
);
const UserRegisterPage = lazyWithCatch(() =>
  import("@/views/user/register/register").then((m) => ({
    default: m.UserRegisterPage,
  })),
);
const AgentPage = lazyWithCatch(() =>
  import("@/views/agent/index").then((m) => ({ default: m.AgentPage })),
);
const AgentCreatePage = lazyWithCatch(() =>
  import("@/views/agent/create/index").then((m) => ({
    default: m.AgentCreatePage,
  })),
);
const AgentCreateV2Page = lazyWithCatch(() =>
  import("@/views/agent/create-v2/index").then((m) => ({
    default: m.AgentCreatePageV2,
  })),
);
// 空间设置 (全屏)
const SpaceSettingLayout = lazy(() =>
  import("@/views/space/setting").then((m) => ({
    default: m.SpaceSettingLayout,
  })),
);
const SpaceSettingBasicInfo = lazy(() =>
  import("@/views/space/setting/pages/basic-info").then((m) => ({
    default: m.BasicInfoPage,
  })),
);
const SpaceSettingMembers = lazy(() =>
  import("@/views/space/setting/pages/members").then((m) => ({
    default: m.MembersPage,
  })),
);
const SpaceSettingKnowledge = lazy(() =>
  import("@/views/space/setting/pages/knowledge").then((m) => ({
    default: m.KnowledgePage,
  })),
);
const SpaceSettingKnowledgeGraph = lazy(() =>
  import("@/views/space/setting/pages/knowledge-graph").then((m) => ({
    default: m.KnowledgeGraphPage,
  })),
);
const SpaceSettingDynamic = lazy(() =>
  import("@/views/space/setting/pages/dynamic").then((m) => ({
    default: m.DynamicPage,
  })),
);
const SpaceSettingRecycle = lazy(() =>
  import("@/views/space/setting/pages/recycle").then((m) => ({
    default: m.RecyclePage,
  })),
);
const AssistantPage = lazy(() =>
  import("@/views/assistant/index").then((m) => ({ default: m.AssistantPage })),
);
const AssistantMapPage = lazyWithCatch(() =>
  import("@/views/assistant/map/index").then((m) => ({
    default: m.AssistantMapPage,
  })),
);
const AppSettingPage = lazyWithCatch(() =>
  import("@/views/assistant/AppSetting").then((m) => ({
    default: m.AppSettingPage,
  })),
);
const ChatPage = lazyWithCatch(() =>
  import("@/views/assistant/chat/index").then((m) => ({ default: m.ChatPage })),
);

const SkillsPage = lazyWithCatch(() => import("@/views/skills/index"));
const SkillDetailPage = lazyWithCatch(() => import("@/views/skills/Detail"));
const TemplateStylePage = lazyWithCatch(() =>
  import("@/views/template-style/index").then((m) => ({
    default: m.TemplateStylePage,
  })),
);
const WorkAIPage = lazyWithCatch(() => import("@/views/work-ai/index"));
const SvgPage = lazyWithCatch(() =>
  import("@/views/svg/index").then((m) => ({ default: m.SvgPage })),
);
const NotFound = lazyWithCatch(() =>
  import("@/views/exception/404").then((m) => ({ default: m.NotFound })),
);
const ServerError = lazyWithCatch(() =>
  import("@/views/exception/500").then((m) => ({ default: m.ServerError })),
);
const MobileTip = lazyWithCatch(() =>
  import("@/views/exception/MobileTip").then((m) => ({ default: m.MobileTip })),
);

export function AppRouter() {
  return (
    <HashRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* Login routes */}
          <Route
            path="/register"
            element={
              <RequireAuth>
                <RegisterForm />
              </RequireAuth>
            }
          />
          <Route
            path="/apply"
            element={
              <RequireAuth>
                <ApplyForm />
              </RequireAuth>
            }
          />

          {/* Full-screen editor routes (outside LayoutShell) */}
          <Route
            path="agent/create-v2"
            element={
              <RequireAuth>
                <AgentCreateV2Page />
              </RequireAuth>
            }
          />
          <Route
            path="skills/create"
            element={
              <RequireAuth>
                <SkillDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="prompt/create"
            element={
              <RequireAuth>
                <PromptCreatePage />
              </RequireAuth>
            }
          />

          {/* Full-screen Space Setting routes (outside LayoutShell) */}
          <Route
            path="space/:id/setting"
            element={
              <RequireAuth>
                <SpaceSettingLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="basic-info" replace />} />
            <Route
              path="basic-info"
              element={<SpaceSettingBasicInfo />}
            />
            <Route path="members" element={<SpaceSettingMembers />} />
            <Route
              path="knowledge"
              element={<SpaceSettingKnowledge />}
            />
            <Route
              path="knowledge-graph"
              element={<SpaceSettingKnowledgeGraph />}
            />
            <Route path="dynamic" element={<SpaceSettingDynamic />} />
            <Route path="recycle" element={<SpaceSettingRecycle />} />
          </Route>

          {/* Main layout routes */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <LayoutShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/index" replace />} />

            {/* Home */}
            <Route path="index" element={<HomePage />} />

            {/* Config */}
            <Route path="config" element={<ConfigPage />} />
            <Route path="info" element={<InfoPage />} />
            <Route path="domain" element={<DomainPage />} />
            <Route path="template-style" element={<TemplateStylePage />} />
            <Route path="statistics" element={<StatisticsPage />} />

            {/* System */}
            <Route path="system-log" element={<SystemLogRefactoredPage />} />
            <Route path="smtp" element={<SMTPPage />} />

            {/* Navigation */}
            <Route path="navigation" element={<NavigationPage />} />
            <Route
              path="navigation/web-setting/:navigation_id"
              element={<WebSettingPage />}
            />

            {/* Order & Payment */}
            <Route path="order" element={<OrderPage />} />
            <Route path="payment" element={<PaymentPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />

            {/* Knowledge */}
            <Route path="knowledge" element={<KnowledgePage />} />

            {/* Prompt */}
            <Route path="prompt" element={<PromptPage />} />

            {/* Search */}
            <Route path="search" element={<SearchPage />} />
            {/* <Route path="search/feedback" element={<SearchFeedbackPage />} />
            <Route path="search/record" element={<SearchRecordPage />} /> */}

            {/* Platform */}
            <Route path="platform" element={<PlatformPage />} />

            {/* User */}
            <Route path="user">
              <Route index element={<Navigate to="/user/admin" replace />} />
              <Route path="admin" element={<UserAdminPage />} />
              <Route path="internal" element={<UserInternalPage />} />
              <Route path="register" element={<UserRegisterPage />} />
            </Route>

            {/* Agent */}
            <Route path="agent" element={<AgentPage />} />
            <Route path="agent/create" element={<AgentCreatePage />} />

            {/* Work AI */}
            <Route path="work-ai" element={<WorkAIPage />} />

            {/* Skills */}
            <Route path="skills" element={<SkillsPage />} />

            {/* Toolbox */}
            <Route path="toolbox" element={<ToolboxRefactoredPage />} />
            <Route path="toolbox/create" element={<ToolkitCreatePage />} />

            {/* Assistant */}
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="assistant/chat" element={<ChatPage />} />
            <Route path="assistant/map" element={<AssistantMapPage />} />
            <Route path="assistant/app-setting" element={<AppSettingPage />} />

          </Route>

          {/* SvgPage */}
          <Route path="/svglist" element={<SvgPage />} />

          {/* Exception pages */}
          <Route path="/404" element={<NotFound />} />
          <Route path="/500" element={<ServerError />} />
          <Route path="/mobile-tip" element={<MobileTip />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}

export default AppRouter;
