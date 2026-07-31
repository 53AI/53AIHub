import { useState, forwardRef, useImperativeHandle } from "react";
import { Modal, Form, Input, Button, message } from "antd";
import { RolePopover } from "@/components/KMPermission";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  SUBJECT_TYPE,
  type PermissionType,
  type ResourceType,
} from "@/components/KMPermission/constant";
import { EntityDisplay } from "@/components/EntityDisplay";
import approvalsApi from "@/api/modules/approvals";
import permissionsApi from "@/api/modules/permissions";
import { t } from "@/locales";

interface PermissionApplicationData {
  resource: {
    icon: string;
    name: string;
    id: string;
    [key: string]: any;
  };
  resourceType: ResourceType;
  permission: PermissionType;
  reason: string;
  approvers: number[];
}

export interface ApplyDialogRef {
  open: (data: {
    resource: any;
    resourceType: ResourceType;
    permission?: PermissionType;
  }) => void;
}

export const ApplyDialog = forwardRef<
  ApplyDialogRef,
  {
    onClose?: () => void;
    onSubmit?: (data: PermissionApplicationData) => void;
  }
>(({ onClose, onSubmit }, ref) => {
  const [visible, setVisible] = useState(false);
  const [form] = Form.useForm();
  const [approvers, setApprovers] = useState<number[]>([]);

  const [resource, setResource] = useState<any>({});
  const [resourceType, setResourceType] = useState<ResourceType>(
    RESOURCE_TYPE.library,
  );

  const loadPermissionDetail = async (
    resourceId: string,
    resType: ResourceType,
  ) => {
    const res = await permissionsApi.detail({
      resource_type: resType,
      resource_id: resourceId,
    });
    const subApprovers = (res.direct || []).filter(
      (item: any) =>
        item.subject_type === SUBJECT_TYPE.user &&
        item.permission === PERMISSION_TYPE.manage,
    );
    const adminApprovers = (res.team_admin || []).filter(
      (item: any) => item.subject_type === SUBJECT_TYPE.user,
    );
    setApprovers([
      ...new Set(
        [...subApprovers, ...adminApprovers].map(
          (item: any) => item.subject_id,
        ),
      ),
    ]);
  };

  const loadLatestPending = async (data: any) => {
    const res = await approvalsApi.latest_pending({
      resource_type: data.resourceType,
      resource_id: data.resource.id,
    });
    return res.pending;
  };

  useImperativeHandle(ref, () => ({
    open: async (data) => {
      const hasPending = await loadLatestPending(data);
      if (hasPending) {
        message.success(t("permission.request_sent_tip"));
        return;
      }
      setResource(data.resource);
      setResourceType(data.resourceType);
      form.setFieldsValue({
        permission: data.permission || PERMISSION_TYPE.viewer,
        reason: "",
      });
      loadPermissionDetail(data.resource.id, data.resourceType);
      setVisible(true);
    },
  }));

  const handleClose = () => {
    setVisible(false);
    form.resetFields();
    onClose?.();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      await approvalsApi.create({
        permission: values.permission,
        resource: resource,
        resource_type: resourceType,
        reason: values.reason,
        resource_id: resource.id,
      });
      message.success(t("status.submitted"));
      handleClose();
      onSubmit?.({
        resource,
        resourceType,
        permission: values.permission,
        reason: values.reason,
        approvers,
      });
    } catch (error) {
      console.error("Form validation failed:", error);
    }
  };

  return (
    <Modal
      open={visible}
      title={t("apply.title")}
      width={500}
      mask={{ closable: false }}
      onCancel={handleClose}
      footer={
        <>
          <Button onClick={handleClose}>{t("action.cancel")}</Button>
          <Button type="primary" onClick={handleSubmit}>
            {t("apply.submit")}
          </Button>
        </>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item label={t("apply.access_label")}>
          <div className="w-full h-10 bg-[#FCFFFE] px-4 flex items-center gap-2 border rounded">
            {resource.icon && (
              <div className="size-6 flex items-center justify-center">
                <img src={resource.icon} className="size-full" alt="" />
              </div>
            )}
            <span className="flex-1 text-sm text-[#4F5052] truncate">
              {resource.name}
            </span>
          </div>
        </Form.Item>

        <Form.Item
          label={t("apply.permission_label")}
          name="permission"
          rules={[{ required: true, message: t("apply.permission_required") }]}
        >
          <RolePopover resourceType={resourceType} />
        </Form.Item>

        <Form.Item label={t("apply.reason_label")} name="reason">
          <Input.TextArea rows={4} placeholder={t("apply.reason_placeholder")} />
        </Form.Item>

        <Form.Item label={t("apply.approver_label")}>
          <div className="text-sm text-gray-600">
            {approvers.map((approver, index) => (
              <span key={approver}>
                <EntityDisplay id={approver} type="user" mode="name" />
                {index < approvers.length - 1 && "; "}
              </span>
            ))}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
});

ApplyDialog.displayName = "ApplyDialog";

export default ApplyDialog;
