import { Button, Spin, message, Menu } from "antd";
import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { eventBus } from "@km/shared-utils";
import { navigationApi } from "@/api/modules/navigation";
import { useEnterpriseStore } from "@/stores";
import UEditor, { UEditorRef } from "@/components/UEditor";
import type { NavigationItem } from "@/api/modules/navigation/types";

interface NavigationDetail {
  name: string;
  updated_time: string;
  content_update_time: string;
  content?: {
    html_content?: string;
    updated_time?: string | number;
  };
}

type NavigationDetailResponse = NavigationItem & {
  updated_time: string;
  content_update_time: string;
  content?: {
    html_content?: string;
    updated_time?: string | number;
  };
};

export function WebSettingPage() {
  const { navigation_id } = useParams<{ navigation_id: string }>();
  const navigate = useNavigate();
  const enterpriseStore = useEnterpriseStore();
  const ueditorRef = useRef<UEditorRef>(null);

  const [navigationDetail, setNavigationDetail] = useState<NavigationDetail>(
    {} as NavigationDetail,
  );
  const [navigationList, setNavigationList] = useState<NavigationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const enterpriseInfo = useMemo(
    () => enterpriseStore.info,
    [enterpriseStore.info],
  );

  const formatLastEditTime = (timestamp?: string | number) => {
    if (!timestamp) return "";
    return new Date(timestamp)
      .toLocaleString()
      .replace(/\//g, "-")
      .slice(0, 15);
  };

  const loadNavigationDetail = async () => {
    if (!navigation_id) return;

    try {
      const data = (await navigationApi.detail(
        Number(navigation_id),
      )) as NavigationDetailResponse;

      // 格式化时间
      data.updated_time = formatLastEditTime(data.updated_time);
      const contentData = data.content || {};
      data.content_update_time = formatLastEditTime(contentData.updated_time);

      // 设置编辑器内容
      ueditorRef.current?.setValue(contentData.html_content || "");
      setNavigationDetail(data as NavigationDetail);
    } catch (error) {
      console.error("加载导航详情失败:", error);
    }
  };

  const loadNavigationList = async () => {
    try {
      const { list = [] } = await navigationApi.list({});
      setNavigationList(list);
    } catch (error) {
      console.error("加载导航列表失败:", error);
    }
  };

  const handleCancel = () => {
    navigate("/config?tab=navigation");
  };

  const handleSave = async () => {
    try {
      const html = await ueditorRef.current?.getHtml();
      if (!html) return;

      setIsSaving(true);

      await navigationApi.saveContent({
        navigation_id: Number(navigation_id),
        html_content: html,
      });

      message.success(t("action_save_success"));
      handleCancel();
    } catch (error) {
      console.error("保存内容失败:", error);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        await Promise.all([loadNavigationList(), loadNavigationDetail()]);
      } finally {
        setIsLoading(false);
      }
    };
    init();
    eventBus.on("user-login-success", loadNavigationDetail);
    return () => {
      eventBus.off("user-login-success", loadNavigationDetail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation_id]);

  return (
    <div className="fixed top-0 left-0 w-screen h-screen z-[9] bg-[#F4F6FA] flex flex-col">
      {/* 头部工具栏 */}
      <header className="flex-none w-full px-[56px] h-[70px] flex items-center gap-3 shadow box-border bg-white ">
        <SvgIcon
          name="web-edit"
          style={{ zoom: 1.2 }}
          width="24"
          color="#858585"
        />
        <div className="flex-1 flex flex-col gap-0.5">
          <span>{navigationDetail.name || t("navigation.web_setting")}</span>
          <span className="text-xs text-hint">
            {t("last_edit")}:{" "}
            {formatLastEditTime(navigationDetail.content_update_time)}
          </span>
        </div>
        <Button className="!ml-0" onClick={handleCancel}>
          {t("action_cancel")}
        </Button>
        <Button
          className="!ml-0"
          type="primary"
          loading={isSaving}
          onClick={handleSave}
        >
          {t("action_save")}
        </Button>
      </header>

      {/* 主要内容区域 */}
      <div className="flex-1 min-h-0">
        <Spin
          spinning={isLoading}
          classNames={{
            root: "h-full",
            container: "h-full py-5",
          }}
        >
          <div className="h-full flex flex-col w-5/6 max-w-[1084px] rounded box-border mx-auto bg-white">
            {/* 导航栏预览 */}
            <div className="w-full h-[76px] px-8 box-border flex items-center gap-4 border-b">
              {enterpriseInfo.logo && (
                <img
                  src={enterpriseInfo.logo}
                  className="flex-none w-10 h-10 rounded"
                  style={{ objectFit: "cover" }}
                  alt="logo"
                />
              )}
              <h2 className="flex-none text-primary font-semibold">
                {enterpriseInfo.display_name || "--"}
              </h2>
              <Menu
                className="flex-1 w-0 overflow-hidden ml-2 !border-none"
                mode="horizontal"
                selectedKeys={[]}
                items={navigationList.map((item) => ({
                  key: item.jump_path || String(item.navigation_id),
                  label: (
                    <span className="!text-base !text-primary">
                      {item.name}
                    </span>
                  ),
                  disabled: true,
                  className: "!cursor-auto !opacity-100",
                }))}
              />
            </div>

            {/* 编辑器区域 */}
            <div className="flex-1 w-full p-2 box-border min-h-[400px]">
              <UEditor ref={ueditorRef} className="h-full" />
            </div>

            {/* 版权信息 */}
            <div className="w-full h-[64px] px-[56px] box-border flex items-center bg-[#22252E] rounded-sm text-sm text-hint">
              {enterpriseInfo.copyright}
            </div>
          </div>
        </Spin>
      </div>
    </div>
  );
}

export default WebSettingPage;
