import { Form, Input, message } from "antd";
import { EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { useCallback, useImperativeHandle, useState, useEffect, useMemo } from "react";
import IconPopover from "@/components/Icon/popover";
import { spacesApi } from "@/api/modules/spaces";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { uploadApi } from "@/api/modules/upload";
import { buildPreviewUrl } from "@/utils/preview";
import { createIconFileFromStatic } from "@km/shared-utils";
import {
  VISIBILITY_TYPE,
  type VisibilityType,
} from "@/components/Permission/constant";
import type {
  TabActionsRef,
  TabStateChangeHandler,
} from "@/views/space/setting/types";
import { t } from "@/locales";

interface VisibilityOption {
  value: VisibilityType;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: VISIBILITY_TYPE.public,
    labelKey: "space.visible",
    descKey: "space.non_space_member_can_view",
    icon: <EyeOutlined style={{ color: "#999", fontSize: 16 }} />,
  },
  {
    value: VISIBILITY_TYPE.private,
    labelKey: "space.invisible",
    descKey: "space.only_space_member_can_view",
    icon: <EyeInvisibleOutlined style={{ color: "#999", fontSize: 16 }} />,
  },
];

export interface BasicInfoTabProps {
  space: SpaceItem;
  onRefresh: () => Promise<void>;
  tabRef?: React.RefObject<TabActionsRef | null>;
  onStateChange?: TabStateChangeHandler;
}

export function BasicInfoTab({
  space,
  onRefresh,
  tabRef,
  onStateChange,
}: BasicInfoTabProps) {
  const [form] = Form.useForm();
  const [iconFile, setIconFile] = useState<File | string>(space.icon || "");
  const [visibility, setVisibility] = useState<VisibilityType>(
    (space.visibility as VisibilityType) ?? VISIBILITY_TYPE.public,
  );
  const [formSnapshot, setFormSnapshot] = useState<{
    name?: string;
    description?: string;
  }>({ name: space.name, description: space.description });
  const [saving, setSaving] = useState(false);

  // 当外部空间切换 / 拉取详情后，把本地状态回滚到最新服务端值
  useEffect(() => {
    form.setFieldsValue({ name: space.name, description: space.description });
    setIconFile(space.icon || "");
    setVisibility(
      (space.visibility as VisibilityType) ?? VISIBILITY_TYPE.public,
    );
    setFormSnapshot({ name: space.name, description: space.description });
  }, [space, form]);

  const onIconParams = useCallback(
    async (data: { icon: string; bgLight: string; bgDark: string }) => {
      try {
        if (data.icon && data.bgLight && data.bgDark) {
          const file = (await createIconFileFromStatic(
            data.icon,
            data.bgLight,
            data.bgDark,
            { size: 100, iconPadding: 24 },
          )) as File;
          setIconFile(file);
        } else {
          setIconFile("");
        }
      } catch (error) {
        console.error(error);
      }
    },
    [],
  );

  const uploadIcon = useCallback(async (file: File) => {
    try {
      const res: any = await uploadApi.upload(file);
      return res?.data;
    } catch (error) {
      return {};
    }
  }, []);

  const iconDirty = useMemo(() => {
    const current = typeof iconFile === "string" ? iconFile : "";
    return current !== (space.icon || "");
  }, [iconFile, space.icon]);

  const visibilityDirty = useMemo(() => {
    const original =
      (space.visibility as VisibilityType) ?? VISIBILITY_TYPE.public;
    return visibility !== original;
  }, [visibility, space.visibility]);

  const formDirty = useMemo(() => {
    return (
      (formSnapshot.name ?? "") !== (space.name ?? "") ||
      (formSnapshot.description ?? "") !== (space.description ?? "")
    );
  }, [formSnapshot, space.name, space.description]);

  const dirty = formDirty || iconDirty || visibilityDirty;

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();

      let icon = typeof iconFile === "string" ? iconFile : "";
      if (iconFile && typeof iconFile !== "string") {
        const res = await uploadIcon(iconFile);
        icon = buildPreviewUrl(res?.preview_key) ?? "";
      }

      await spacesApi.update(space.id, {
        name: values.name,
        description: values.description || "",
        icon,
        visibility,
        permissions: [],
      });
      message.success(t("message_status.save_success"));
      await onRefresh();
      return true;
    } catch (error) {
      console.error("Save basic info error:", error);
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    form,
    iconFile,
    visibility,
    space.id,
    onRefresh,
    uploadIcon,
  ]);

  useImperativeHandle(
    tabRef,
    () => ({
      save: handleSave,
      getState: () => ({ dirty, saving }),
    }),
    [handleSave, dirty, saving],
  );

  useEffect(() => {
    onStateChange?.({ dirty, saving });
  }, [dirty, saving, onStateChange]);

  return (
    <div className="h-full overflow-y-auto py-2">
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_, allValues) =>
          setFormSnapshot({
            name: allValues.name,
            description: allValues.description,
          })
        }
      >
        {/* Icon + Name */}
        <div className="flex gap-4 items-center mb-[18px]">
          <IconPopover
            value={typeof iconFile === "string" ? iconFile : ""}
            onChange={(url) => setIconFile(url)}
            onIconParams={onIconParams}
            className="w-[60px] h-[60px]"
          />
          <Form.Item
            className="flex-1 mb-0"
            label={t("common.name")}
            name="name"
            rules={[{ required: true, message: t("space.name_placeholder") }]}
          >
            <Input
              allowClear
              placeholder={t("space.name_placeholder")}
              maxLength={20}
              showCount
            />
          </Form.Item>
        </div>

        {/* Description */}
        <Form.Item label={t("space.description")} name="description">
          <Input.TextArea
            placeholder={t("space.description_placeholder")}
            rows={5}
            style={{ resize: "none" }}
          />
        </Form.Item>

        {/* Visibility */}
        <div className="mt-6">
          <div className="text-sm text-[#1D1E1F] mb-2">
            {t("space.visibility_setting")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {VISIBILITY_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className={`rounded-md border p-3 relative cursor-pointer ${
                  visibility === opt.value
                    ? "bg-[#2563EB14] border-[#2563EB]"
                    : ""
                }`}
                onClick={() => setVisibility(opt.value)}
              >
                <div className="mb-2 flex items-center gap-1">
                  {opt.icon}
                  <span className="text-sm text-[#1D1E1F]">
                    {t(opt.labelKey)}
                  </span>
                </div>
                <div className="text-xs text-[#939499]">{t(opt.descKey)}</div>
                <div className="absolute top-1 right-1">
                  <input
                    type="radio"
                    checked={visibility === opt.value}
                    value={opt.value}
                    onChange={() => setVisibility(opt.value)}
                    className="accent-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Form>

    </div>
  );
}

export default BasicInfoTab;
