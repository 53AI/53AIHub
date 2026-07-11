import { useNavigate } from "react-router-dom";
import { LeftOutlined } from "@ant-design/icons";

interface HeaderProps {
  back?: boolean;
  title?: string;
  titlePrefix?: React.ReactNode;
  titleSuffix?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function Header({
  back = false,
  title = "",
  titlePrefix,
  titleSuffix,
  right,
  className = "",
}: HeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    const { back: hasBack } = window.history.state;
    if (hasBack) {
      navigate(-1);
    } else {
      // 如果没有上一页，则返回到一级目录
      navigate("/");
    }
  };

  return (
    <div className={`flex-none flex items-center justify-between gap-3 ${className}`}>
      <div className="flex-1 flex items-center gap-3">
        {back && (
          <div
            className="w-7 h-7 flex items-center justify-center cursor-pointer"
            onClick={handleBack}
          >
            <LeftOutlined style={{ fontSize: 18 }} />
          </div>
        )}
        {titlePrefix}
        <h2 className="text-[26px] text-[#1D1E1F] font-semibold">{title}</h2>
        {titleSuffix}
      </div>
      {right}
    </div>
  );
}

export default Header;
