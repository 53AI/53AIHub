import { Outlet } from "react-router-dom";

/**
 * 简单的 RouterView 包装组件
 * 对应 Vue 版本的 Child.vue
 */
export function Child() {
  return <Outlet />;
}
