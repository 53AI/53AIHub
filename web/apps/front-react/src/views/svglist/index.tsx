import { useEffect, useState } from "react";
import { SvgIcon } from "@km/shared-components-react";

export function SvgListView() {
  const [lists, setLists] = useState<string[]>([]);

  useEffect(() => {
    const svgs = document.querySelectorAll("#__svg__icons__dom__ symbol");
    const names = Array.from(svgs).map((item) => {
      const id = item.getAttribute("id") || "";
      return id.replace("icon-", "");
    });
    setLists(names);
  }, []);

  return (
    <div className="flex flex-wrap gap-4 p-4">
      {lists.map((name, index) => (
        <div
          key={index}
          className="flex flex-col items-center p-2 border rounded hover:bg-gray-50 cursor-pointer"
          style={{ minWidth: "80px" }}
          onClick={() => {
            navigator.clipboard.writeText(name);
          }}
          title="点击复制图标名称"
        >
          <span className="text-xs text-gray-500 mb-1 truncate w-full text-center">
            {name}
          </span>
          <SvgIcon name={name} size={30} color="#182B50" />
        </div>
      ))}
    </div>
  );
}

export default SvgListView;
