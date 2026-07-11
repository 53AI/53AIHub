import {
    Button,
    Divider,
    Form,
    Input,
    InputNumber,
    ColorPicker,
    Space,
    message,
} from "antd";
import { useEffect, useState, useMemo } from "react";
import { t } from "@/locales";
import { useEnterpriseStore } from "@/stores";
import { SvgIcon } from "@km/shared-components-react";
import { ImageUpload } from "@/components/Upload/image";
import {
    templateStyleApi,
    TemplateStyleForm,
    defaultForm,
} from "@/api/modules/template-style";
import bannerApi from "@/api/modules/banner";
import {
    transformBanner,
    getDefaultBanner,
} from "@/api/modules/banner/transform";
import type { Banner } from "@/api/modules/banner/types";
import { BANNER_CONFIG } from "@/constants/banner";
import {
    WEBSITE_STYLE,
    WEBSITE_STYLE_LABEL_MAP,
    WEBSITE_STYLE_DEMO_MAP,
} from "@/constants/enterprise";
import { getRealPath } from "@/utils/config";

const UPLOAD_COUNT_LIMIT = BANNER_CONFIG.MAX_IMAGES;

export function TemplateStylePage() {
  const enterpriseStore = useEnterpriseStore();
  const [form] = Form.useForm<TemplateStyleForm>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(getDefaultBanner());
  const [styleType, setStyleType] = useState<string>(WEBSITE_STYLE.SOFTWARE);

  const addDisabled = useMemo(() => {
    return banner.url_list.length >= UPLOAD_COUNT_LIMIT;
  }, [banner.url_list.length]);

  // Fetch data
  const fetchBannerData = async () => {
    const data = await bannerApi.get().then(transformBanner);
    setBanner({
      url_list: data.url_list || [],
      interval: data.interval || BANNER_CONFIG.DEFAULT_INTERVAL,
    });
  };

  const fetchTemplateStyleData = async () => {
    setLoading(true);
    try {
      const data = await templateStyleApi.getTemplateStyle();
      const newStyleType = data.style_type || WEBSITE_STYLE.SOFTWARE;
      setStyleType(newStyleType);
      form.setFieldsValue({
        style_type: newStyleType,
        theme_color: data.theme_color || "#3664EF",
        text_color: data.text_color || "#333333",
        nav_bg_color: data.nav_bg_color || "#ffffff",
        nav_text_color: data.nav_text_color || "#333333",
        page_footer_bg_color: data.page_footer_bg_color || "#18191F",
        page_footer_text_color: data.page_footer_text_color || "#F2F2F2",
        icp_license: data.icp_license || "",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchBannerData(), fetchTemplateStyleData()]);
  }, []);

  // Handlers
  const handleImageUploadConfirm = (url: string, index?: number) => {
    if (index !== undefined && banner.url_list[index]) {
      const newList = [...banner.url_list];
      newList[index] = url;
      setBanner({ ...banner, url_list: newList });
    } else {
      setBanner({ ...banner, url_list: [...banner.url_list, url] });
    }
  };

  const handleImageDelete = (index: number) => {
    const newList = banner.url_list.filter((_, i) => i !== index);
    setBanner({ ...banner, url_list: newList });
  };

  const handleIntervalChange = (value: number | null) => {
    setBanner({ ...banner, interval: value || BANNER_CONFIG.DEFAULT_INTERVAL });
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
      setSubmitting(true);

      const values = form.getFieldsValue();
      // Use styleType state since style_type is not registered via Form.Item
      const currentStyleType = styleType;

      if (currentStyleType === WEBSITE_STYLE.WEBSITE) {
        await templateStyleApi.saveTemplateStyle({
          ...values,
          style_type: currentStyleType,
        });
        await bannerApi.save(banner);
        message.success(t("action_save_success"));
        fetchTemplateStyleData();
        fetchBannerData();
      } else {
        await templateStyleApi.saveTemplateStyle({
          ...defaultForm,
          style_type: WEBSITE_STYLE.SOFTWARE,
        });
        setStyleType(WEBSITE_STYLE.SOFTWARE);
        message.success(t("action_save_success"));
      }

      enterpriseStore.loadSelfInfo();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 bg-white px-2 h-full overflow-y-auto">
      <Form form={form} className="flex-1" colon={false}>
        <Form.Item label={t("template_style.website_style")}>
          <ul className="flex flex-wrap gap-4">
            {[WEBSITE_STYLE.WEBSITE, WEBSITE_STYLE.SOFTWARE].map((value) => (
              <li
                key={value}
                className={`w-[172px] p-1.5 bg-[#F5F5F5] flex relative flex-col cursor-pointer items-center gap-2 border rounded box-border overflow-hidden text-sm hover:border-[#3664EF] hover:text-brand ${
                  styleType === value
                    ? "border-[#3664EF] text-brand"
                    : "text-secondary"
                }`}
                onClick={() => {
                  form.setFieldValue("style_type", value);
                  setStyleType(value);
                }}
              >
                {styleType === value && (
                  <>
                    <div
                      className="absolute top-0 right-0"
                      style={{
                        width: 0,
                        height: 0,
                        borderTop: "31px solid #3664ef",
                        borderLeft: "29px solid transparent",
                      }}
                    />
                    <SvgIcon
                      name="check_v2"
                      className="absolute !w-4 h-2 top-0 right-0 text-white"
                    />
                  </>
                )}
                <div className="text-sm p-1.5">
                  {t(WEBSITE_STYLE_LABEL_MAP.get(value) || "")}
                </div>
                <img
                  className="w-full"
                  src={getRealPath(WEBSITE_STYLE_DEMO_MAP.get(value) || "")}
                  alt=""
                />
              </li>
            ))}
          </ul>
          <div className="w-full h-5"></div>
          {styleType === WEBSITE_STYLE.WEBSITE && (
            <Form.Item
              label={t("template_style.theme_color")}
              labelCol={{ flex: "70px" }}
            >
              <ul className="flex items-center flex-wrap gap-5 text-secondary text-sm">
                <li className="flex items-center gap-2">
                  <Form.Item name="theme_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.theme_color_v2")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Form.Item name="text_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.text_color")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Form.Item name="nav_bg_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.nav_bg_color")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Form.Item name="nav_text_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.nav_text_color")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Form.Item name="page_footer_bg_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.page_footer_bg_color")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Form.Item name="page_footer_text_color" noStyle getValueFromEvent={(color) => color?.toHexString?.() ?? color}>
                    <ColorPicker showText />
                  </Form.Item>
                  <span>{t("template_style.page_footer_text_color")}</span>
                </li>
              </ul>
            </Form.Item>
          )}
          {styleType === WEBSITE_STYLE.WEBSITE && (
            <Form.Item
              label={t("module.banner_diagram")}
              labelCol={{ flex: "70px" }}
            >
              <div className="w-full h-2"></div>
              <Form.Item>
                <div className="text-hint text-xs w-full">
                  {t("banner.upload_image_tip")}
                </div>
                {banner.url_list.length > 0 && (
                  <ul className="mt-4 w-full flex flex-col gap-4">
                    {banner.url_list.map((url, index) => (
                      <li key={url} className="w-full relative">
                        <ImageUpload
                          value={url}
                          className="!w-full !h-[14vw]"
                          cropperDisabled
                          onConfirm={({ url: newUrl }) =>
                            handleImageUploadConfirm(newUrl, index)
                          }
                          maskText={
                            <>
                              <SvgIcon
                                name="edit"
                                className="cursor-pointer"
                                size={24}
                                color="#fff"
                              />
                              <SvgIcon
                                name="delete"
                                className="cursor-pointer"
                                size={24}
                                color="#fff"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleImageDelete(index);
                                }}
                              />
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <ImageUpload
                  className="w-auto h-auto"
                  cropperDisabled
                  disabled={addDisabled}
                  onConfirm={({ url }) => handleImageUploadConfirm(url)}
                >
                  <Button
                    className="mt-4 "
                    color="primary"
                    variant="filled"
                    disabled={addDisabled}
                  >
                    + {t("action_add")}({banner.url_list.length}/
                    {UPLOAD_COUNT_LIMIT})
                  </Button>
                </ImageUpload>
              </Form.Item>
              <Form.Item label={t("banner.interval")} layout="vertical">
                <div className="text-hint text-xs w-full">
                  {t("banner.interval_tip")}
                </div>
                <Space.Compact style={{ display: "flex", marginTop: 16 }}>
                  <InputNumber
                    className="!w-[250px]"
                    value={banner.interval}
                    onChange={handleIntervalChange}
                    min={1}
                    max={1000}
                    controls={false}
                  />
                  <Input
                    disabled
                    value={t("second")}
                    style={{ width: 50, textAlign: "center" }}
                  />
                </Space.Compact>
              </Form.Item>
            </Form.Item>
          )}
          <div className="w-full h-3"></div>
          {styleType === WEBSITE_STYLE.WEBSITE && (
            <Form.Item
              className="mt-5"
              label={t("module.icp_license")}
              name="icp_license"
              labelCol={{ flex: "70px" }}
            >
              <Input className="!w-[660px]" placeholder="请输入备案信息" />
            </Form.Item>
          )}
        </Form.Item>
      </Form>
      <Divider className="!my-3" />
      <div>
        <Button type="primary" loading={submitting} onClick={handleSave}>
          {t("action_save")}
        </Button>
      </div>
    </div>
  );
}

export default TemplateStylePage;
