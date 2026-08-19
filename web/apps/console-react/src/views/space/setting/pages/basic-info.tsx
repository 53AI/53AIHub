import { Button, Form, Input, Modal, message } from "antd";
import { EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { useCallback, useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Header } from "@/components/Header";
import IconPopover from "@/components/Icon/popover";
import { spacesApi } from "@/api/modules/spaces";
import { uploadApi } from "@/api/modules/upload";
import { buildPreviewUrl } from "@/utils/preview";
import { createIconFileFromStatic } from "@km/shared-utils";
import {
  VISIBILITY_TYPE,
  type VisibilityType,
} from "@/components/Permission/constant";
import type { SpaceSettingContext } from "../index";
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

export function BasicInfoPage() {
  const { space, reload } = useOutletContext<SpaceSettingContext>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [iconFile, setIconFile] = useState<File | string>(space.icon || "");
  const [visibility, setVisibility] = useState<VisibilityType>(
    (space.visibility as VisibilityType) ?? VISIBILITY_TYPE.public,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enableWikiKG, setEnableWikiKG] = useState(false);
  const [enableWikiDynamic, setEnableWikiDynamic] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      name: space.name,
      description: space.description,
    });
    setIconFile(space.icon || "");
    setVisibility(
      (space.visibility as VisibilityType) ?? VISIBILITY_TYPE.public,
    );
    setEnableWikiKG((space as any).enable_wiki_knowledge_graph ?? false);
    setEnableWikiDynamic((space as any).enable_wiki_dynamic_knowledge ?? false);
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
        enable_wiki_knowledge_graph: enableWikiKG,
        enable_wiki_dynamic_knowledge: enableWikiDynamic,
      });
      message.success(t("message_status.save_success"));
      await reload();
    } catch (error) {
      console.error("Save basic info error:", error);
    } finally {
      setSaving(false);
    }
  }, [form, iconFile, visibility, enableWikiKG, enableWikiDynamic, space.id, reload, uploadIcon]);

  const handleDelete = useCallback(() => {
    Modal.confirm({
      title: t("space.delete_confirm"),
      content: (
        <div>
          <p className="text-tag-red">{t("space.delete_confirm_warning")}</p>
          <p>
            {t("space.delete_confirm_input_hint", {
              name: space.name,
            })}
          </p>
          <Input
            placeholder={t("space.delete_confirm_tip_placeholder")}
            id="delete-confirm-input"
          />
        </div>
      ),
      okText: t("action_delete"),
      okButtonProps: { danger: true },
      cancelText: t("action_cancel"),
      centered: true,
      onOk: async () => {
        const input = document.getElementById(
          "delete-confirm-input",
        ) as HTMLInputElement;
        const value = input?.value || "";
        if (value !== space.name) {
          message.error(t("space.delete_confirm_tip_placeholder"));
          return Promise.reject();
        }
        try {
          setDeleting(true);
          await spacesApi.delete(space.id);
          message.success(t("action_delete_success"));
          navigate("/space");
        } catch (error) {
          console.error("Delete space error:", error);
          return Promise.reject();
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [space.id, space.name, navigate]);

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[78px] bg-[#fff]">
      <Header className="pt-8 pb-5" title={t("space.setting.menu.basicInfo")} />
      <div className="flex-1 gap-6 py-8 overflow-y-auto mb-5">
        <Form form={form} layout="vertical" className="max-w-[800px]">
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

          
          <div className="p-4 border rounded flex items-center">
            <div className="flex-1">
              <h3 className="text-base text-primary">{t("module.knowledge_graph")}</h3>
              <p className="text-sm text-tertiary mt-1">{t("space.knowledge_graph_desc")}</p>
            </div>
            <Button
              color={enableWikiKG ? 'danger' : 'primary'}
              variant={enableWikiKG ? 'outlined' : 'filled'}
              onClick={() => {
                const next = !enableWikiKG;
                setEnableWikiKG(next);
                if (!next && enableWikiDynamic) {
                  setEnableWikiDynamic(false);
                }
              }}
            >
              {enableWikiKG ? t("action.disable") : t("action_enable")}
            </Button>
          </div>

          <div className="p-4 border rounded flex items-center mt-3">
            <div className="flex-1">
              <h3 className="text-base text-primary">{t("module.dynamic_knowledge")}</h3>
              <p className="text-sm text-tertiary mt-1">{t("space.knowledge_graph_desc")}</p>
            </div>
            <Button
              color={enableWikiDynamic ? 'danger' : 'primary'}
              variant={enableWikiDynamic ? 'outlined' : 'filled'}
              onClick={() => {
                if (!enableWikiDynamic && !enableWikiKG) {
                  message.warning(t("space.enable_dynamic_knowledge_tip"));
                  return;
                }
                setEnableWikiDynamic(!enableWikiDynamic);
              }}
            >
              {enableWikiDynamic ? t("action.disable") : t("action_enable")}
            </Button>
          </div>

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


          {/* Save */}
          <Button
            type="primary"
            className="mt-6"
            loading={saving}
            onClick={handleSave}
          >
            {t("action_save")}
          </Button>
        </Form>
      </div>
    </div>
  );
}

export default BasicInfoPage;
