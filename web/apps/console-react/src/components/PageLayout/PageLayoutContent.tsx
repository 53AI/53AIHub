import { PageHeader } from "./PageHeader";
import type { PageLayoutContentProps } from "./types";

export function PageLayoutContent({
  header,
  filterBar,
  children,
  className = "",
  headerClassName = "mb-3",
  contentClassName = "",
  footer,
  scrollable = true,
}: PageLayoutContentProps) {
  return (
    <div className={`px-[60px] py-8 h-full flex flex-col ${className}`}>
      <PageHeader config={header} className={headerClassName} />

      {filterBar && (
        <div className="flex-none flex items-center justify-between mb-4">
          {filterBar}
        </div>
      )}
      <div
        className={`flex-1 min-h-0 flex flex-col bg-white rounded-lg ${contentClassName}`}
      >
        <div
          className={`flex-1 ${scrollable ? "overflow-y-auto" : "min-h-0"}`}
        >
          {children}
        </div>
        {footer && <div className="flex-none border-t px-4 py-5 bg-white">{footer}</div>}
      </div>
    </div>
  );
}
