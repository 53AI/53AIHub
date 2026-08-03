import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import { IndexSidebar } from "./IndexSidebar";

export function IndexLayout() {
  // 登录后让 Outlet 重新挂载，强制 ChatView 重新执行依赖登录态的接口（myList 等）
  const [chatRenderKey, setChatRenderKey] = useState(0);
  const bumpChatRenderKey = useCallback(() => {
    setChatRenderKey((key) => key + 1);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <IndexSidebar
        chatRenderKey={chatRenderKey}
        onChatRenderKeyChange={bumpChatRenderKey}
      />
      <div className="flex-1 overflow-hidden" key={chatRenderKey}>
        <Outlet />
      </div>
    </div>
  );
}

export default IndexLayout;
