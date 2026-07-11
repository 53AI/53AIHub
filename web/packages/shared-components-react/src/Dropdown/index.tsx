import { useMemo } from "react";
import type { DropdownProps, MenuProps } from "antd";
import { Dropdown as OriginalDropdown } from "antd";

/**
 * 封装 antd Dropdown，自动阻止菜单项点击事件冒泡
 * 解决在 Table 等可点击容器中使用时，菜单项点击会触发父元素点击事件的问题
 */
const WrappedDropdown: React.FC<DropdownProps> & {
  Button: typeof OriginalDropdown.Button;
} = ({ menu, ...props }) => {
  const wrappedMenu = useMemo<MenuProps | undefined>(() => {
    if (!menu) return undefined;

    // 处理 menu.onClick（菜单整体的点击回调）
    const wrappedOnClick = menu.onClick
      ? (e: any) => {
          e.domEvent?.stopPropagation();
          menu.onClick!(e);
        }
      : undefined;

    // 处理 items[].onClick（每个菜单项单独的点击回调）
    const wrappedItems = menu.items?.map((item: any) => {
      if (!item || typeof item.onClick !== "function") return item;

      return {
        ...item,
        onClick: (e: any) => {
          e.domEvent?.stopPropagation();
          item.onClick(e);
        },
      };
    });

    return {
      ...menu,
      onClick: wrappedOnClick,
      items: wrappedItems,
    };
  }, [menu]);

  return <OriginalDropdown menu={wrappedMenu} {...props} />;
};

WrappedDropdown.Button = OriginalDropdown.Button;

export default WrappedDropdown;
export type { DropdownProps, MenuProps };
