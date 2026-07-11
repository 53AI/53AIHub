import { Outlet } from "react-router-dom";
import { IndexSidebar } from "./IndexSidebar";

export function IndexLayout() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <IndexSidebar />
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

export default IndexLayout;
