import {
    Drawer,
    Form,
    Input,
    Radio,
    Button,
    Divider,
    message,
    Image,
} from "antd";
import {
    useState,
    useMemo,
    forwardRef,
    useImperativeHandle
} from "react";
import { t } from "@/locales";
import { useNavigate } from "react-router-dom";
import { navigationApi } from "@/api/modules/navigation";
import { useEnterpriseStore } from "@/stores";
import { useEnv } from "@/hooks/useEnv";
import { img_host } from "@/utils/config";
import IconPopover from "@/components/Icon/popover";
import {
    NAVIGATION_TYPE,
    NAVIGATION_TARGET,
    NAVIGATION_TYPE_LABEL_MAP,
    NAVIGATION_TARGET_LABEL_MAP,
    NAVIGATION_CUSTOM_PATH_BLACKLIST,
} from "@/constants/navigation";
import type {
    NavigationItem,
    CreateNavigationData,
    UpdateNavigationData,
} from "@/api/modules/navigation/types";

interface FormData {
  type: number;
  name: string;
  icon: string;
  jump_path: string;
  target: number;
  seo_title: string;
  seo_keywords: string;
  seo_description: string;
}

export interface CreateDrawerRef {
  open: (params: {
    data?: Partial<NavigationItem>;
    navigationList?: NavigationItem[];
  }) => void;
  close: () => void;
}

interface CreateDrawerProps {
  onSuccess: () => void;
}

const CreateDrawer = forwardRef<CreateDrawerRef, CreateDrawerProps>(
  ({ onSuccess }, ref) => {
    const navigate = useNavigate();
    const enterpriseStore = useEnterpriseStore();
    const { isOpLocalEnv, isPrivatePremEnv } = useEnv();
    const [form] = Form.useForm<FormData>();
    const [submitting, setSubmitting] = useState(false);
    const [visible, setVisible] = useState(false);
    const [originData, setOriginData] = useState<Partial<NavigationItem>>({});
    const [navigationList, setNavigationList] = useState<NavigationItem[]>([]);

    const isEditable = !!originData.navigation_id;

    const enterpriseInfo = useMemo(
      () => enterpriseStore.info,
      [enterpriseStore.info],
    );

    const domainUrl = useMemo(() => {
      const baseUrl =
        isOpLocalEnv || isPrivatePremEnv
          ? window.location.origin
          : enterpriseInfo.domain;
      return `${baseUrl}/#`;
    }, [isOpLocalEnv, isPrivatePremEnv, enterpriseInfo.domain]);

    const open = ({
      data = {},
      navigationList: _navigationList = [],
    }: {
      data?: Partial<NavigationItem>;
      navigationList?: NavigationItem[];
    } = {}) => {
      const config = (data as any).config || {};
      form.setFieldsValue({
        type: data.type || NAVIGATION_TYPE.EXTERNAL,
        name: data.name || "",
        icon: (data as any).icon || `${img_host}/icon/icon1.png`,
        jump_path: data.jump_path || "",
        target: config.target || data.target || NAVIGATION_TARGET.SELF,
        seo_title: config.seo_title || "",
        seo_keywords: config.seo_keywords || "",
        seo_description: config.seo_description || "",
      });
      setOriginData(data);
      setNavigationList(_navigationList);
      setVisible(true);
    };

    const close = () => {
      setVisible(false);
    };

    useImperativeHandle(ref, () => ({
      open,
      close,
    }));

    const handleTypeChange = () => {
      form.resetFields(["jump_path"]);
    };

    const handleSave = async () => {
      try {
        const values = await form.validateFields();
        setSubmitting(true);

        const saveData: CreateNavigationData | UpdateNavigationData = {
          ...(originData.navigation_id
            ? { navigation_id: String(originData.navigation_id) }
            : {}),
          type: values.type,
          name: values.name,
          jump_path: values.jump_path,
          sort: originData.sort || 9999 - navigationList.length,
          config: {
            target: values.target,
            seo_title: values.seo_title,
            seo_keywords: values.seo_keywords?.replace(/，/g, ",") || "",
            seo_description: values.seo_description,
          },
          icon: values.icon,
        };

        const result = await navigationApi.save(saveData);
        message.success(t("action_save_success"));
        onSuccess();
        close();

        if (!isEditable && values.type === NAVIGATION_TYPE.CUSTOM) {
          const navigationId =
            (result as any)?.navigation_id || originData.navigation_id;
          if (navigationId) {
            navigate(`/navigation/web-setting/${navigationId}`);
          }
        }
      } catch (error) {
        console.error("保存导航失败:", error);
      } finally {
        setSubmitting(false);
      }
    };

    const validatePath = async (_: unknown, value: string) => {
      if (!value) return Promise.resolve();

      if (form.getFieldValue("type") === NAVIGATION_TYPE.CUSTOM) {
        const exists = navigationList.some(
          (item) =>
            item.jump_path === value &&
            item.navigation_id !== originData.navigation_id,
        );
        if (exists) {
          return Promise.reject(new Error(t("form_path_same_tip")));
        }

        const firstSegment =
          value.replace(/^\/+/, "").split("/")[0]?.toLowerCase() || "";
        if (NAVIGATION_CUSTOM_PATH_BLACKLIST.includes(firstSegment as any)) {
          return Promise.reject(
            new Error(t("module.nav_custom_path_blacklist_tip")),
          );
        }
      }
      return Promise.resolve();
    };

    const iconValue = Form.useWatch("icon", form);
    const typeValue = Form.useWatch("type", form);

    return (
      <Drawer
        open={visible}
        title={t(isEditable ? "action_edit" : "action_create")}
        onClose={close}
        destroyOnHidden
        mask={{ closable: false }}
        styles={{ wrapper: { width: 700 } }}
        footer={
          <div className="flex gap-4  justify-end w-full">
            <Button onClick={close}>{t("action_cancel")}</Button>
            <Button type="primary" loading={submitting} onClick={handleSave}>
              {t("action_save")}
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" className="px-4">
          <h1 className="font-semibold text-primary mb-6">
            {t("basic_info")}
          </h1>

          <Form.Item label={t("type")} name="type">
            <Radio.Group onChange={handleTypeChange}>
              {[
                NAVIGATION_TYPE.SYSTEM,
                NAVIGATION_TYPE.EXTERNAL,
                NAVIGATION_TYPE.CUSTOM,
              ].map((value) => (
                <Radio
                  key={value}
                  value={value}
                  disabled={
                    originData.type === NAVIGATION_TYPE.SYSTEM ||
                    value === NAVIGATION_TYPE.SYSTEM ||
                    isEditable
                  }
                >
                  {t(NAVIGATION_TYPE_LABEL_MAP.get(value) || "")}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label={t("icon")}
            name="icon"
            rules={[{ required: true, message: t("form_select_placeholder") }]}
          >
            <div className="flex items-center gap-4">
              <IconPopover
                value={iconValue}
                onChange={(url) => form.setFieldValue("icon", url)}
                onIconParams={(data) => form.setFieldValue("icon", data.icon)}
                showBg={false}
                showUpload={false}
                disabled={typeValue === NAVIGATION_TYPE.SYSTEM}
              >
                <div className="size-12 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
                  <Image
                    className="size-6 overflow-hidden"
                    src={iconValue || `${img_host}/icon/icon1.png`}
                    alt=""
                    style={{ objectFit: "contain" }}
                    preview={false}
                    fallback="/images/default_agent.png"
                  />
                </div>
              </IconPopover>
            </div>
          </Form.Item>

          <Form.Item
            label={t("name")}
            name="name"
            rules={[{ required: true, message: t("form_input_placeholder") }]}
          >
            <Input
              maxLength={20}
              showCount
              placeholder={t("form_input_placeholder")}
            />
          </Form.Item>

          <Form.Item shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) => {
              const type = getFieldValue("type");
              if (type === NAVIGATION_TYPE.SYSTEM) {
                return (
                  <Form.Item label={t("jump_path")}>
                    <Input
                      disabled
                      value={`${domainUrl}${getFieldValue("jump_path") || ""}`}
                    />
                  </Form.Item>
                );
              } else if (type === NAVIGATION_TYPE.EXTERNAL) {
                return (
                  <Form.Item
                    label={t("jump_path")}
                    name="jump_path"
                    rules={[
                      { required: true, message: t("form_input_placeholder") },
                      { validator: validatePath },
                    ]}
                  >
                    <Input placeholder={t("form_input_placeholder")} />
                  </Form.Item>
                );
              } else {
                return (
                  <Form.Item
                    label={t("jump_path")}
                    name="jump_path"
                    rules={[
                      { required: true, message: t("form_input_placeholder") },
                      { validator: validatePath },
                    ]}
                  >
                    <div className="flex items-center">
                      <span className="flex items-center px-3 h-[32px] bg-[#f5f5f5] border border-r-0 border-[#d9d9d9] rounded-l text-sm text-tertiary whitespace-nowrap">
                        {domainUrl}
                      </span>
                      <Input
                        className="!rounded-l-none flex-1"
                        placeholder={t("form_input_placeholder")}
                      />
                    </div>
                  </Form.Item>
                );
              }
            }}
          </Form.Item>

          <Form.Item label={t("open_method")} name="target">
            <Radio.Group>
              {[NAVIGATION_TARGET.SELF, NAVIGATION_TARGET.BLANK].map(
                (value) => (
                  <Radio key={value} value={value}>
                    {t(NAVIGATION_TARGET_LABEL_MAP.get(value) || "")}
                  </Radio>
                ),
              )}
            </Radio.Group>
          </Form.Item>

          <Divider />

          <h1 className="font-semibold text-primary mb-6">
            {t("module.nav_seo_setting")}
          </h1>

          <Form.Item label={t("module.nav_seo_setting_title")} name="seo_title">
            <Input
              maxLength={60}
              showCount
              placeholder={t("form_input_placeholder")}
            />
          </Form.Item>

          <Form.Item
            label={t("module.nav_seo_setting_keywords")}
            name="seo_keywords"
          >
            <Input placeholder={t("form_input_placeholder")} />
          </Form.Item>
          <div className="mt-2 text-xs text-placeholder -mt-4 mb-4">
            {t("module.nav_seo_setting_keywords_tip")}
          </div>

          <Form.Item
            label={t("module.nav_seo_setting_description")}
            name="seo_description"
          >
            <Input.TextArea
              rows={5}
              maxLength={100}
              showCount
              placeholder={t("form_input_placeholder")}
              style={{ resize: "none" }}
            />
          </Form.Item>
        </Form>
      </Drawer>
    );
  },
);

CreateDrawer.displayName = "CreateDrawer";

export default CreateDrawer;
