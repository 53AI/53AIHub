import React, { useState, useEffect, useMemo } from "react";
import { Drawer, Form, Input, Button, message, Modal } from "antd";
import { t } from "@/locales";
import UserStatus from "./UserInternalStatus";
import { DeptMemberPicker } from "@/components/DeptMemberPicker";
import { INTERNAL_USER_STATUS_UNDEFINED, userApi } from "@/api/modules/user";
import { useUserStore } from "@/stores";

interface UserInternalEditDrawerProps {
  open: boolean;
  data?: any;
  onClose: () => void;
  onSuccess: () => void;
}

const UserInternalEditDrawer: React.FC<UserInternalEditDrawerProps> = ({
  open,
  data = {},
  onClose,
  onSuccess,
}) => {
  const userStore = useUserStore();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [originalData, setOriginalData] = useState<any>({});

  const userInfo = useMemo(() => userStore.info, [userStore.info]);

  useEffect(() => {
    if (open && data) {
      const memberBindingInfo = (data.memberbindings || [])[0] || {};
      // 兼容两种数据源：departments (fetch_internal_user) 和 department_relations (organization)
      const departments = data.departments || data.department_relations || [];
      form.setFieldsValue({
        name: memberBindingInfo.name || "",
        nickname: data.nickname || "",
        mobile: data.mobile || "",
        department: departments.map((item: any) => ({
          name: item.name,
          label: item.name,
          value: item.did ?? item.bind_value ?? item.value ?? 0,
        })),
        status: data.status
          ? Number(data.status)
          : INTERNAL_USER_STATUS_UNDEFINED,
      });
      setOriginalData(data);
    }
    // 注意：不在这里处理 else 分支重置表单
    // 因为 destroyOnHidden 会在关闭时销毁 Form，此时调用 form.resetFields() 会产生警告
  }, [open, data, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const updatePayload = {
        user_id: originalData.user_id,
        department: (values.department || []).map(
          (item: any) => item.value ?? item.did ?? item,
        ),
        mobile: values.mobile,
        nickname: values.nickname,
        status: values.status,
      };

      const res: any = await userApi.update_internal_user(updatePayload);
      const failed = res?.data?.failed || res?.failed || [];

      if (failed && failed.length > 0) {
        const registerList = failed
          .filter((item: any) => item.existing_type == 1)
          .map((item: any) => {
            return { ...item, did: 0 }; // Assuming did 0 for fallback, as in Vue
          });

        if (registerList.length > 0) {
          Modal.confirm({
            title: t("tip"),
            content: t("internal_user.account.register_to_internal_confirm", {
              mobile: registerList.map((item: any) => item.username).join("、"),
            }),
            onOk: async () => {
              await userApi.register_to_internal({
                user_departments: registerList.map((item: any) => ({
                  did: item.did,
                  user_id: item.user_id,
                })),
              });
              onSuccess();
              message.success(t("action_save_success"));
              onClose();
            },
          });
          return;
        }
      }

      onSuccess();
      message.success(t("action_save_success"));
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={t("internal_user.account.edit_member")}
      open={open}
      onClose={onClose}
      destroyOnHidden
      mask={{ closable: false }}
      styles={{ wrapper: { width: 700 } }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("action_cancel")}</Button>
          <Button type="primary" loading={submitting} onClick={handleSave}>
            {t("action_save")}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" className="w-full">
        <Form.Item
          label={t("internal_user.account.name")}
          name="name"
          extra={t("internal_user.account.name_disabled_tip")}
        >
          <Input
            disabled
            placeholder={t("internal_user.account.name_placeholder")}
          />
        </Form.Item>

        <Form.Item
          label={t("internal_user.account.nickname")}
          name="nickname"
          rules={[
            {
              required: true,
              message: t("internal_user.account.nickname_placeholder"),
            },
          ]}
        >
          <Input
            placeholder={t("internal_user.account.nickname_placeholder")}
          />
        </Form.Item>

        <Form.Item
          label={t("internal_user.account.mobile")}
          name="mobile"
          extra={t("internal_user.account.mobile_disabled_tip")}
          rules={[
            {
              required: true,
              message: t("internal_user.account.mobile_placeholder"),
            },
            {
              pattern: /^1[3-9]\d{9}$/,
              message: t("internal_user.account.mobile_placeholder"),
            },
          ]}
        >
          <Input
            autoComplete="new-mobile"
            placeholder={t("internal_user.account.mobile_placeholder")}
            disabled={originalData.status !== INTERNAL_USER_STATUS_UNDEFINED}
            allowClear
          />
        </Form.Item>

        <Form.Item
          label={t("internal_user.account.department")}
          name="department"
        >
          <DeptMemberPicker type="department" />
        </Form.Item>

        <Form.Item label={t("internal_user.account.status")} name="status">
          <UserStatus userData={originalData} actionDisabled buttonDisabled={originalData.user_id === userInfo?.user_id || originalData.is_creator} />
        </Form.Item>
      </Form>
    </Drawer>
  );
};

export default UserInternalEditDrawer;
