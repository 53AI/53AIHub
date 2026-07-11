import { Modal, Form, Input, Button, message } from "antd";
import { t } from "@/locales";
import { useState, useEffect } from "react";
import { PlusOutlined, MinusCircleOutlined } from "@ant-design/icons";
import { userApi } from "@/api/modules/user";
import { SvgIcon } from "@km/shared-components-react";

interface UserInternalAddDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  organizationData?: any;
}

export default function UserInternalAddDialog({
  open,
  onClose,
  onSuccess,
  organizationData,
}: UserInternalAddDialogProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [allUserList, setAllUserList] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      fetchAllUser();
      form.setFieldsValue({
        users: [
          {
            nickname: "",
            username: "",
            password: "",
            did: organizationData?.did || 0,
          },
        ],
      });
    }
  }, [open, form, organizationData]);

  const fetchAllUser = async () => {
    try {
      const { list = [] } = await userApi.fetch_internal_user({
        offset: 0,
        limit: 10000,
      });
      setAllUserList(list);
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirm = async () => {
    try {
      const values = await form.validateFields();
      const users = values.users.map((item: any) => ({
        ...item,
        did: item.did || 0,
      }));

      setSubmitting(true);
      const res: any = await userApi.batch_save_internal_user({ users });

      const failed = res?.data?.failed || res?.failed || [];
      if (failed && failed.length > 0) {
        const registerList = failed
          .filter((item: any) => item.existing_type == 1)
          .map((item: any) => {
            const data =
              users.find((u: any) => u.username === item.username) || {};
            return { ...item, did: data.did || 0 };
          });

        // 处理非注册用户的已存在账号（如站点创建者）
        const otherExistingList = failed.filter(
          (item: any) => item.existing_type != 1
        );

        // 如果有非注册用户的已存在账号，显示错误提示
        if (otherExistingList.length > 0) {
          message.error(
            otherExistingList.map((item: any) => item.message).join("、")
          );
          return;
        }

        if (registerList.length > 0) {
          Modal.confirm({
            title: t("tip"),
            content: t("internal_user.account.register_to_internal_confirm", {
              mobile: registerList.map((item: any) => item.message).join("、"),
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
    <Modal
      title={t("action_add")}
      open={open}
      onCancel={onClose}
      width={920}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("action_cancel")}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={handleConfirm}
        >
          {t("action_confirm")}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" className="w-full mt-4">
        <Form.List name="users">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <div
                  key={key}
                  className="flex gap-4 items-start w-full relative"
                >
                  <Form.Item
                    {...restField}
                    name={[name, "nickname"]}
                    label={t("internal_user.account.name")}
                    rules={[
                      {
                        required: true,
                        message: t("internal_user.account.name_placeholder"),
                      },
                    ]}
                    className="flex-1"
                  >
                    <Input
                      placeholder={t("internal_user.account.name_placeholder")}
                    />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, "username"]}
                    label={t("internal_user.account.mobile")}
                    rules={[
                      {
                        required: true,
                        message: t("internal_user.account.mobile_placeholder"),
                      },
                      {
                        pattern: /^1[3-9]\d{9}$/,
                        message: t("internal_user.account.mobile_placeholder"),
                      },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value) return Promise.resolve();
                          // 同时检查 username 和 mobile 字段，因为已存在用户的手机号可能存储在任一字段
                          if (
                            allUserList.some((item) => item.username === value || item.mobile === value)
                          ) {
                            return Promise.reject(
                              new Error(
                                t(
                                  "internal_user.account.same_member_exists_tip",
                                ),
                              ),
                            );
                          }
                          const users = getFieldValue("users") || [];
                          const sameIndexList: number[] = [];
                          users.forEach((item: any, idx: number) => {
                            if (idx !== name && item?.username === value) {
                              sameIndexList.push(idx + 1);
                            }
                          });
                          if (sameIndexList.length > 0) {
                            return Promise.reject(
                              new Error(
                                t(
                                  "internal_user.account.same_mobile_exists_tip",
                                  { index: sameIndexList.join("、") },
                                ),
                              ),
                            );
                          }
                          return Promise.resolve();
                        },
                      }),
                    ]}
                    className="flex-1"
                  >
                    <Input
                      placeholder={t(
                        "internal_user.account.mobile_placeholder",
                      )}
                    />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, "password"]}
                    label={t("password")}
                    rules={[
                      {
                        required: true,
                        message: t(
                          "internal_user.account.password_placeholder",
                        ),
                      },
                      { min: 8, max: 20, message: t("login.password_length") },
                    ]}
                    className="flex-1"
                  >
                    <Input.Password
                      placeholder={t(
                        "internal_user.account.password_placeholder",
                      )}
                    />
                  </Form.Item>

                  {fields.length > 1 && (
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(name)}
                      className="mt-8"
                    />
                  )}
                </div>
              ))}
              <Form.Item>
                <Button
                  color="primary"
                  variant="link"
                  className="px-0"
                  onClick={() => {
                    const users = form.getFieldValue("users") || [];
                    const lastUser = users[users.length - 1] || {};
                    add({
                      nickname: "",
                      username: "",
                      password: lastUser.password || "",
                      did: lastUser.did || organizationData?.did || 0,
                    });
                  }}
                >
                  <SvgIcon name="plus" />
                  {t("internal_user.account.add")}
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
