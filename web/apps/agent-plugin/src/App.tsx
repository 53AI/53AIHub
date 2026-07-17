import { useState, useEffect, useMemo, useCallback } from "react";
import { ChatConfigProvider } from "@km/shared-business/chat";
import { adapters } from "./adapters";
import { ChatView } from "./views/chat";
import { useUserStore } from "./stores/user";
import { AgentNotFound } from "./components/AgentNotFound";
import { getFingerprint } from "./utils/fingerprint";
import { agentAgentApi } from "./adapters/agent";

/** Detect if running inside iframe (embed mode) */
function useIsEmbedMode(): boolean {
  return useMemo(() => {
    return window !== window.top || new URLSearchParams(window.location.search).get("embed") === "true";
  }, []);
}

/** Send close request to parent (SDK) */
function useEmbedClose() {
  return useCallback(() => {
    if (window.parent) {
      window.parent.postMessage({ type: 'CLOSE_REQUEST' }, '*');
    }
  }, []);
}

function LoadingScreen({ message = "加载中..." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-b from-[#eaf3ff] to-white">
      <div className="text-gray-500">{message}</div>
    </div>
  );
}

type AppState = 'loading' | 'agent_check' | 'h5_login' | 'ready' | 'error';

function App() {
  const { h5Login, ssoLogin, getUserInfo, getAccessToken, removeAccessToken } = useUserStore();
  const [appState, setAppState] = useState<AppState>('loading');
  const [agentInfo, setAgentInfo] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const isEmbedMode = useIsEmbedMode();
  const handleEmbedClose = useEmbedClose();

  const urlParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      token: params.get('token') || '',
      username: params.get('username') || '',
      timestamp: params.get('timestamp') || '',
      sign: params.get('sign') || '',
      embed: params.get('embed') === 'true',
    };
  }, []);

  useEffect(() => {
    if (isEmbedMode) {
      document.body.classList.add('embed-mode');
    }
    return () => {
      document.body.classList.remove('embed-mode');
    };
  }, [isEmbedMode]);

  useEffect(() => {
    let cancelled = false;

    const initApp = async () => {
      // Must have token parameter
      if (!urlParams.token) {
        if (!cancelled) {
          setErrorMessage('缺少必要参数');
          setAppState('error');
        }
        return;
      }

      if (!cancelled) setAppState('agent_check');

      // Step 1: Get agent info with fixed_token
      let agentId: string | number;
      try {
        const info = await (agentAgentApi as any).getH5Info(urlParams.token);
        if (cancelled) return;
        setAgentInfo(info);
        agentId = info.agent_id;
        if (info.name) {
          document.title = info.name;
        }
        if (info.logo) {
          let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
          if (!link) {
            link = document.createElement("link");
            document.getElementsByTagName("head")[0].appendChild(link);
          }
          link.type = "image/x-icon";
          link.rel = "shortcut icon";
          link.href = info.logo;
        }
      } catch (err) {
        if (!cancelled) {
          console.error('获取智能体信息失败:', err);
          setErrorMessage('智能体不存在');
          setAppState('error');
        }
        return;
      }

      // Step 2: Check existing access_token for this agent (skip if SSO login needed)
      if (!urlParams.username) {
        const existingToken = getAccessToken(agentId);
        if (existingToken) {
          try {
            await getUserInfo(agentId);
            if (cancelled) return;
            setAppState('ready');
            return;
          } catch {
            if (cancelled) return;
            removeAccessToken(agentId);
            localStorage.removeItem('user_info');
          }
        }
      }

      // Step 3: Login flow
      if (!cancelled) setAppState('h5_login');
      try {
        if (urlParams.username) {
          // SSO identity binding login
          await ssoLogin({
            sign: urlParams.sign || '',
            timestamp: urlParams.timestamp || '',
            username: urlParams.username,
            agentId: agentId
          });
        } else {
          // Fingerprint-based visitor login
          const fingerprint = await getFingerprint();
          if (cancelled) return;
          await h5Login(urlParams.token, fingerprint);
        }
        if (!cancelled) setAppState('ready');
      } catch (err) {
        if (!cancelled) {
          console.error('登录失败:', err);
          setErrorMessage('登录失败');
          setAppState('error');
        }
      }
    };

    initApp();

    return () => {
      cancelled = true;
    };
  }, [urlParams.token, urlParams.username, urlParams.sign, urlParams.timestamp, h5Login, ssoLogin, getUserInfo, getAccessToken, removeAccessToken]);

  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  if (appState === 'loading' || appState === 'agent_check' || appState === 'h5_login') {
    return <LoadingScreen />;
  }

  if (appState === 'error') {
    return (
      <div className="relative h-screen">
        {isEmbedMode && (
          <div
            className="fixed top-4 right-4 z-50 w-8 h-8 flex items-center justify-center rounded cursor-pointer hover:bg-gray-100"
            onClick={handleEmbedClose}
          >
            <span className="text-gray-400 text-xl">×</span>
          </div>
        )}
        <AgentNotFound message={errorMessage} onRetry={handleRetry} />
      </div>
    );
  }

  // Ready state - show chat
  return (
    <div className="relative h-screen">
      <ChatConfigProvider lang="zh-cn" adapters={adapters}>
        <ChatView agentId={agentInfo?.agent_id} agentInfo={agentInfo} />
      </ChatConfigProvider>
    </div>
  );
}

export default App;