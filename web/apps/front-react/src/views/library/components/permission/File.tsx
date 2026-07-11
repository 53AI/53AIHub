import { useMemo } from "react";
import { useLibraryStore } from "@/stores/modules/library";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from "@/components/KMPermission/constant";
import PermissionTooltip from "@/components/KMPermission/tooltip";

interface FilePermissionProps {
  permission?: PermissionType;
  required: PermissionType;
  resource?: {
    id: string;
    icon: string;
    name: string;
    isfile: boolean;
  };
  placement?: string;
  inline?: boolean;
  getPopupContainer?: () => HTMLElement;
  children: React.ReactNode;
}

export default function FilePermission({
  permission,
  required = PERMISSION_TYPE.viewer,
  resource,
  placement,
  inline,
  getPopupContainer,
  children,
}: FilePermissionProps) {
  // 正确订阅 Zustand store 的响应式属性
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const libraryId = useLibraryStore((state) => state.library?.id);

  const currentFile = useMemo(() => {
    return files.find((item) => item.id === currentFileId);
  }, [files, currentFileId]);

  const currentPermission = useMemo(() => {
    return typeof permission === "undefined"
      ? currentFile?.permission
      : permission;
  }, [permission, currentFile?.permission]);

  const permissionResource = useMemo(() => {
    const file = resource || currentFile;
    return {
      library_id: libraryId,
      id: file?.id,
      icon: file?.icon,
      name: file?.name,
      isfile: file?.isfile,
    };
  }, [resource, currentFile, libraryId]);

  return (
    <PermissionTooltip
      permission={currentPermission}
      required={required}
      resourceType={RESOURCE_TYPE.file}
      resource={permissionResource}
      placement={placement as any}
      inline={inline}
      getPopupContainer={getPopupContainer}
    >
      {children}
    </PermissionTooltip>
  );
}
