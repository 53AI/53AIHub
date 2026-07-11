import { createContext, useContext } from "react";

interface SidebarContextType {
  showSider: boolean;
  siderVisible: boolean;
  isMobile: boolean;
  handleToggle: () => void;
}

export const SidebarContext = createContext<SidebarContextType>({
  showSider: true,
  siderVisible: false,
  isMobile: false,
  handleToggle: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}