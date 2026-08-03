import {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { Modal, Form, Input, Button, message } from "antd";
import { SetIcon, type SetIconRef } from "./SetIcon";
import { t } from "@/locales";
import {
  MemberSelector,
  GroupList,
  RolePopover,
} from "@/components/KMPermission";
import { EntityDisplay } from "@/components/EntityDisplay";
import {
  RESOURCE_TYPE,
  SUBJECT_TYPE,
  PERMISSION_TYPE,
  type PermissionType,
} from "@/components/KMPermission/constant";
import { permissionsApi, type PermissionItem } from "@/api/modules/permissions";
import librariesApi, { type LibraryItem } from "@/api/modules/libraries";
import { getPublicPath } from "@/utils/config";
import { createIconFileFromStatic } from "@km/shared-utils";
import UploadService from "@/services/upload";
import "./InfoSaveDialog.css";

interface FormValues {
  name: string;
  description: string;
  icon: string;
}

interface PermissionMember {
  subject_id: number;
  subject_type: number;
  permission: PermissionType;
}

interface InfoSaveDialogProps {
  spaceId: string;
  onSuccess?: () => void;
}

export interface InfoSaveDialogRef {
  open: (data?: LibraryItem) => void;
  close: () => void;
}

// Get default library permissions
const getLibraryDefault = (): PermissionItem[] => [
  {
    id: 0,
    created_time: 0,
    eid: "",
    resource_id: "",
    resource_type: RESOURCE_TYPE.library,
    subject_id: 0,
    subject_type: SUBJECT_TYPE.space_admin,
    permission: PERMISSION_TYPE.inherit,
    updated_time: 0,
  },
  {
    id: 0,
    created_time: 0,
    eid: "",
    resource_id: "",
    resource_type: RESOURCE_TYPE.library,
    subject_id: 0,
    subject_type: SUBJECT_TYPE.space_user,
    permission: PERMISSION_TYPE.inherit,
    updated_time: 0,
  },
];

export const InfoSaveDialog = forwardRef<
  InfoSaveDialogRef,
  InfoSaveDialogProps
>(({ spaceId, onSuccess }, ref) => {
  const [form] = Form.useForm<FormValues>();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [originalData, setOriginalData] = useState<LibraryItem | undefined>();
  const [icon, setIcon] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [permissions, setPermissions] = useState<PermissionMember[]>([]);
  const [defaultPermissions, setDefaultPermissions] =
    useState<PermissionItem[]>(getLibraryDefault());
  const [spaceAdminList, setSpaceAdminList] = useState<PermissionItem[]>([]);
  const [spaceUserList, setSpaceUserList] = useState<PermissionItem[]>([]);

  const setIconRef = useRef<SetIconRef>(null);

  const loadSpacePermission = useCallback(async () => {
    try {
      const res = await permissionsApi.list({
        resource_type: RESOURCE_TYPE.space,
        resource_id: spaceId,
      });
      const list = res.filter((item) =>
        (
          [
            SUBJECT_TYPE.user,
            SUBJECT_TYPE.group,
            SUBJECT_TYPE.company_all,
          ] as number[]
        ).includes(item.subject_type),
      );
      setSpaceAdminList(
        list.filter((item) => item.permission === PERMISSION_TYPE.manage),
      );
      setSpaceUserList(
        list.filter((item) => item.permission !== PERMISSION_TYPE.manage),
      );
    } catch (error) {
      console.error("Failed to load space permissions:", error);
    }
  }, [spaceId]);

  const open = useCallback(
    (data?: LibraryItem) => {
      form.setFieldsValue({
        name: data?.name || "",
        description: data?.description || "",
      });
      setIcon(data?.icon || "");
      setPermissions((data as any)?.permissions || []);
      setOriginalData(data);
      setDefaultPermissions(getLibraryDefault());
      setVisible(true);

      if (!data) {
        loadSpacePermission();
      }
    },
    [form, loadSpacePermission],
  );

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open,
      close,
    }),
    [open, close],
  );

  const handleMemberConfirm = (data: { list: PermissionMember[] }) => {
    setPermissions((prev) => {
      const newPermissions = [...prev];
      data.list.forEach((member) => {
        if (
          newPermissions.some((item) => item.subject_id === member.subject_id)
        )
          return;
        newPermissions.push({
          subject_id: member.subject_id,
          permission: member.permission,
          subject_type: member.subject_type,
        });
      });
      return newPermissions;
    });
  };

  const handlePermissionSelect = (
    permission: PermissionType,
    index: number,
  ) => {
    if (permission === PERMISSION_TYPE.remove) {
      setPermissions((prev) => prev.filter((_, i) => i !== index));
    } else {
      setPermissions((prev) => {
        const newPermissions = [...prev];
        newPermissions[index] = { ...newPermissions[index], permission };
        return newPermissions;
      });
    }
  };

  const handleIconParams = async (data: {
    icon: string;
    bgLight: string;
    bgDark: string;
  }) => {
    try {
      if (data.icon && data.bgLight && data.bgDark) {
        const file = (await createIconFileFromStatic(
          data.icon,
          data.bgLight,
          data.bgDark
        )) as File;
        setIconFile(file);
      } else {
        setIconFile(null);
      }
    } catch (error) {
      console.error("Failed to create icon file:", error);
    }
  };

  const cropperSuccess = async (dataFile: File): Promise<string> => {
    try {
      const result = await UploadService.uploadImage(dataFile, {
        onError: (error: any) => {
          message.error(`上传失败：${error.message}`);
        },
      });
      return result.url;
    } catch (error) {
      return "";
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      let iconUrl = icon;

      // Upload icon file if exists
      if (iconFile) {
        iconUrl = await cropperSuccess(iconFile);
      }

      const submitData = {
        name: values.name,
        description: values.description,
        icon: iconUrl,
        space_id: spaceId,
      };

      if (originalData) {
        // Update existing library
        await librariesApi.update(originalData.id, submitData);
        message.success(t("action.save_success"));
      } else {
        // Create new library with permissions
        const allPermissions = [
          ...permissions,
          ...defaultPermissions
            .filter((item) => item.permission !== PERMISSION_TYPE.inherit)
            .map((item) => ({
              subject_type: item.subject_type,
              subject_id: item.subject_id,
              permission: item.permission,
            })),
        ];

        await librariesApi.create({
          ...submitData,
          permissions: allPermissions,
        });
        message.success(t("action.create_success"));
      }

      setVisible(false);
      onSuccess?.();
    } catch (error: any) {
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setVisible(false);
  };

  const handleDefaultPermissionChange = (
    index: number,
    permission: PermissionType,
  ) => {
    setDefaultPermissions((prev) => {
      const newList = [...prev];
      newList[index] = { ...newList[index], permission };
      return newList;
    });
  };

  return (
    <Modal
      open={visible}
      title={originalData ? t("action.edit") : t("action.create")}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText={t("action.confirm")}
      cancelText={t("action.cancel")}
      confirmLoading={loading}
      width={500}
      centered
      destroyOnHidden
      mask={{ closable: false }}
      className="info-save-dialog"
    >
      <Form
        form={form}
        layout="vertical"
        className="info-save-form"
      >
        <div className="flex items-center gap-4 mb-3">
          <SetIcon
            ref={setIconRef}
            value={icon}
            onChange={setIcon}
            onIconParams={handleIconParams}
            className="w-[60px] h-[60px]"
          />
          <Form.Item
            name="name"
            label={t("form.name")}
            className="flex-1 !mb-0"
            rules={[{ required: true, message: t("form.input_placeholder") }]}
          >
            <Input
              placeholder={t("form.input_placeholder")}
              allowClear
              maxLength={20}
              showCount
            />
          </Form.Item>
        </div>

        <Form.Item name="description" label={t("form.desc")}>
          <Input.TextArea
            placeholder={t("form.library_desc_placeholder")}
            rows={5}
            style={{ resize: "none" }}
            maxLength={150}
            showCount
          />
        </Form.Item>

        {/* Member permissions - only for create mode */}
        {!originalData && (
          <Form.Item label="成员与权限">
            <div className="flex justify-end -mt-8 mb-2">
              <MemberSelector
                trigger={
                  <Button type="link" className="px-0">
                    +添加成员
                  </Button>
                }
                onConfirm={handleMemberConfirm}
              />
            </div>
            <div className="w-full p-3 bg-[#F7F8FA] rounded-xl">
              <div className="max-h-52 overflow-y-auto">
                {/* Default permissions for space admin/user */}
                {defaultPermissions.map((permission, index) => (
                  <GroupList
                    key={permission.subject_type}
                    title={
                      index === 0
                        ? `团队空间的管理员(${spaceAdminList.length})`
                        : `团队空间的成员(${spaceUserList.length})`
                    }
                    value={permission}
                    userList={index === 0 ? spaceAdminList : spaceUserList}
                    resourceType={RESOURCE_TYPE.library}
                    onChange={(value) =>
                      handleDefaultPermissionChange(
                        index,
                        value.permission as PermissionType,
                      )
                    }
                  />
                ))}

                {/* Selected members list */}
                {permissions.length > 0 && (
                  <>
                    <div className="border-t my-1" />
                    {permissions.map((member, index) => (
                      <div
                        key={`${member.subject_type}-${member.subject_id}`}
                        className="flex items-center justify-between rounded-md px-0.5 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          {member.subject_type === SUBJECT_TYPE.company_all ? (
                            <>
                              <img
                                src={getPublicPath("/images/space/group.png")}
                                alt="admin"
                                className="size-5"
                              />
                              <span className="text-sm text-[#1D1E1F]">
                                所有成员
                              </span>
                            </>
                          ) : (
                            <EntityDisplay
                              id={member.subject_id}
                              mode="full"
                              type={
                                member.subject_type === SUBJECT_TYPE.user
                                  ? "user"
                                  : "group"
                              }
                            />
                          )}
                        </div>
                        <RolePopover
                          value={member.permission}
                          remove
                          none
                          onSelect={(permission) =>
                            handlePermissionSelect(permission, index)
                          }
                        />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
});

InfoSaveDialog.displayName = "InfoSaveDialog";

export default InfoSaveDialog;
