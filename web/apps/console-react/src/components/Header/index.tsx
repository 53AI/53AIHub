import { LeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

export interface HeaderProps {
  className?: string;
  back?: boolean;
  title?: string;
  titlePrefix?: React.ReactNode;
  titleSuffix?: React.ReactNode;
  right?: React.ReactNode;
}

export function Header({
  className = "",
  back = false,
  title = "",
  titlePrefix,
  titleSuffix,
  right,
}: HeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    // React Router 使用 idx 来跟踪历史位置
    // idx > 0 表示有历史记录可以返回
    const state = window.history.state || {};
    const hasHistory = state.idx !== undefined ? state.idx > 0 : false;

    if (hasHistory) {
      navigate(-1);
    } else {
      // 如果没有上一页，则返回到首页
      navigate("/");
    }
  };

  return (
    <div
      className={`flex-none flex items-center justify-between gap-3 ${className}`}
    >
      <div className="flex-1 flex items-center gap-3">
        {back && (
          <div
            className="w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-gray-100 rounded"
            onClick={handleBack}
          >
            <LeftOutlined style={{ fontSize: 18 }} />
          </div>
        )}
        {titlePrefix}
        <h2 className="text-[26px] text-primary font-semibold">{title}</h2>
        {titleSuffix}
      </div>
      {right}
    </div>
  );
}

export default Header;
