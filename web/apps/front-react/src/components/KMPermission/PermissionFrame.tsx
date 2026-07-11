import React, { useState, useEffect, useMemo } from 'react';
import { Button, message } from 'antd';
import { useLibraryStore } from '@/stores/modules/library';
import { PERMISSION_TYPE, RESOURCE_TYPE, PermissionType } from '@/components/KMPermission/constant';
import PermissionEmpty from '@/components/KMPermission/PermissionEmpty';
import { eventBus } from '@km/shared-utils';
import approvalsApi from '@/api/modules/approvals';

interface PermissionFrameProps {
  required?: PermissionType;
  children?: React.ReactNode;
  onLoad?: () => void;
}

const PermissionFrame: React.FC<PermissionFrameProps> = ({
  required = PERMISSION_TYPE.viewer,
  children,
  onLoad
}) => {
  const libraryStore = useLibraryStore();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSended, setIsSended] = useState(false);

  const permission = useMemo(() => {
    const value = libraryStore.currentFile?.permission;
    return typeof value === 'number' ? value : PERMISSION_TYPE.loading;
  }, [libraryStore.currentFile?.permission]);

  const handleApply = () => {
    eventBus.emit('apply-open', {
      permission: PERMISSION_TYPE.viewer,
      resource: libraryStore.currentFile,
      resourceType: RESOURCE_TYPE.file,
    });
  };

  const handleSend = () => {
    message.success('已提交到管理员，请耐心等待');
    setIsSended(true);
  };

  const loadLatestPending = () => {
    const resource_id = libraryStore.currentFile?.id;
    if (!resource_id) return;
    approvalsApi.latest_pending({
      resource_type: RESOURCE_TYPE.file,
      resource_id
    }).then((res: any) => {
      setIsSubmitted(res.pending);
    });
  };

  useEffect(() => {
    if (permission && permission > required) {
      onLoad?.();
    } else if (permission > PERMISSION_TYPE.loading && permission < required) {
      loadLatestPending();
    }
  }, [permission, required]);

  useEffect(() => {
    const handleApplySubmit = () => {
      setIsSubmitted(true);
      setIsSended(true);
    };
    eventBus.on('apply-submit', handleApplySubmit);
    return () => {
      eventBus.off('apply-submit', handleApplySubmit);
    };
  }, []);

  if (permission === PERMISSION_TYPE.loading) {
    return null;
  }

  if (permission < required) {
    return (
      <PermissionEmpty className="h-full">
        {!isSubmitted && (
          <Button type="primary" onClick={handleApply}>
            申请文档权限
          </Button>
        )}
        {isSubmitted && !isSended && (
          <Button type="primary" onClick={handleSend}>
            催一催
          </Button>
        )}
        {isSubmitted && isSended && (
          <Button type="primary" disabled>
            已提交申请
          </Button>
        )}
      </PermissionEmpty>
    );
  }

  return <>{children}</>;
};

export default PermissionFrame;