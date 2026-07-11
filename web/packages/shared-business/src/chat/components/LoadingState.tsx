import { memo } from "react";
import { LoadingOutlined } from "@ant-design/icons";

export interface LoadingStateProps {
  message?: string;
}

function LoadingStateInner({ message }: LoadingStateProps) {
  return (
    <div className="flex items-center justify-center h-screen bg-white">
      <div className="flex items-center gap-2">
        <LoadingOutlined className="text-xl animate-spin" />
        {message && <div className="text-gray-500">{message}</div>}
      </div>
    </div>
  );
}

const LoadingState = memo(LoadingStateInner);
LoadingState.displayName = "LoadingState";

export default LoadingState;