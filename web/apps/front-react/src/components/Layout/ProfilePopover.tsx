import { useState, useEffect } from "react";
import { Tooltip, message, Avatar, Badge } from "antd";
import {
  UserOutlined,
  QuestionCircleOutlined,
  LogoutOutlined, RightOutlined, SettingOutlined,
  ArrowUpOutlined
} from "@ant-design/icons";
import { useUserStore } from "@/stores/modules/user";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import { getPublicPath, admin_url } from "@/utils/config";
import { eventBus } from "@km/shared-utils";
import { EVENT_NAMES } from "@/constants/events";
import commonApi from "@/api/modules/common";
import subscriptionApi from "@/api/modules/subscription";
import { SvgIcon } from "@km/shared-components-react";
import { GeneralSettingsModal } from "./GeneralSettingsModal";
import { MessageCenter } from "./MessageCenter";
import { showUpgradeModal } from "@/utils/permission";
import "./ProfilePopover.css";

interface ProfilePopoverProps {
  children: React.ReactNode;
  placement?: string;
  onProfile?: () => void;
  unreadCount?: number
  showMessageCenter?: boolean;
}

export function ProfilePopover({
  children,
  onProfile,
  unreadCount = 0,
  placement = "bottomRight",
  showMessageCenter = false,
}: ProfilePopoverProps) {
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();

  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messageCenterOpen, setMessageCenterOpen] = useState(false);

  const validateUpgrade = async () => {
    if (userStore.info.access_token && !userStore.info.is_internal) {
      try {
        const { list = [] } = await subscriptionApi.list();
        setUpgradeVisible(list.length > 0);
      } catch {
        setUpgradeVisible(false);
      }
    }
  };

  const handleUpgrade = () => {
    showUpgradeModal();
  };

  const handleJumpToAdmin = () => {
    const url = `${admin_url}?access_token=${userStore.info.access_token}&eid=${userStore.info.eid}&from_origin=${encodeURIComponent(window.location.origin)}`;
    console.info("adminUrl: ", url);
    window.open(url, "_blank");
  };

  const handleTip = () => {
    message.info('敬请期待')
  }

  const handleProfile = () => {
    setOpen(false);
    onProfile?.();
  };

  const handleLogout = () => {
    setOpen(false);
    userStore.logout();
    message.success(t("status.logout_success"));
  };

  const handleShow = async () => {
    if (version) return;
    try {
      const data = await commonApi.version();
      setVersion(data.version);
    } catch (error) {
      console.error("Failed to get version:", error);
    }
  };

  useEffect(() => {
    validateUpgrade();
    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, validateUpgrade);
    return () => {
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, validateUpgrade);
    };
  }, []);

  const content = (
    <>
      {/* User info header */}
      <div className="bg-[#F6F7FA] p-3 rounded-xl">
        <div className="flex items-center gap-3">
          <Avatar
            size={48}
            src={userStore.info.avatar}
            className="flex-none"
            icon={<UserOutlined />}
          />
          <div className="flex-1 overflow-hidden">
            <div className="w-full flex items-center gap-1 overflow-hidden">
              <p className="flex-1 text-base text-[#1D1E1F] font-medium truncate">
                {userStore.info.nickname}
              </p>
              {!userStore.info.is_internal && userStore.info.group_name && (
                <div
                  className="h-6 flex items-center gap-1 bg-[#F7F7F7] rounded-full px-2 text-xs text-[#999999] whitespace-nowrap"
                  title={userStore.info.group_name}
                >
                  <img
                    src={
                      !/\.png$/.test(userStore.info.group_icon || "")
                        ? getPublicPath(
                            `/images/subscription/${userStore.info.group_icon}.png`,
                          )
                        : userStore.info.group_icon
                    }
                    className="w-4 h-4 object-cover"
                    alt=""
                  />
                  <p className="max-w-[5em] truncate">
                    {userStore.info.group_name}
                  </p>
                </div>
              )}
              {upgradeVisible && !userStore.info.is_internal && (
                <div
                  className="flex items-center gap-1 ml-auto cursor-pointer hover:opacity-70 bg-[#F4F0FF] rounded-2xl h-6 px-2 box-border text-xs text-[#8E5EFF] whitespace-nowrap"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpgrade();
                  }}
                >
                  <ArrowUpOutlined style={{ fontSize: 12 }} />
                  {t("subscription.upgrade")}
                </div>
              )}
            </div>
            <div className="text-xs text-[#9A9A9A]">{userStore.info.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          {Boolean(userStore.info.role) && userStore.info.role > 1 && ( <div className="flex-1 h-8 rounded-md bg-white flex items-center justify-center gap-1 cursor-pointer hover:opacity-50" onClick={handleJumpToAdmin}>
            <SettingOutlined style={{ fontSize: 14, color: "#1D1E1F" }} />
            <span className="text-sm text-[#1D1E1F]">{t("common.go_admin")}</span>
          </div>
          )}
          {!enterpriseStore.is_independent && ( <div className="flex-1 h-8 rounded-md bg-white flex items-center justify-center gap-1 opacity-50" onClick={handleTip}>
            <SvgIcon name="people-plus" size="16" />
            <span className="text-sm text-[#1D1E1F]">邀请同事</span>
          </div>
          )}
        </div>
      </div>

      {/* Menu items */}
      <div className="flex flex-col gap-1.5 py-1.5 ">
        <div
          onClick={handleProfile}
          className="h-8 px-3 flex items-center gap-2 rounded cursor-pointer hover:bg-[#ECEDEE] text-[#1D1E1F]"
        >
          <div className="flex items-center justify-center size-6">
            <UserOutlined style={{ fontSize: 16, color: "#1D1E1F" }} />
          </div>
          <span className="flex-1 text-sm">{t("profile.setting")}</span>
          <div className="text-[#B3ADAD]">
            <RightOutlined style={{ fontSize: 14 }} />
          </div>
        </div>
        <div
          onClick={() => {
            setOpen(false);
            setSettingsOpen(true);
          }}
          className="h-8 px-3 flex items-center gap-2 rounded cursor-pointer hover:bg-[#ECEDEE] text-[#1D1E1F]"
        >
          <div className="flex items-center justify-center size-6">
            <SvgIcon name="setting2" size={16} color="#1D1E1F" />
          </div>
          <span className="flex-1 text-sm">通用设置</span>
          <div className="text-[#B3ADAD]">
            <RightOutlined style={{ fontSize: 14 }} />
          </div>
        </div>

        <a
          href="https://doc.53ai.com/%E7%A4%BE%E5%8C%BA/%E9%9C%80%E6%B1%82%E6%94%AF%E6%8C%81.html"
          target="_blank"
          rel="noopener noreferrer"
          className="h-8 px-3 flex items-center gap-2 rounded cursor-pointer hover:bg-[#ECEDEE]"
        >
          <div className="flex items-center justify-center size-6">
            <QuestionCircleOutlined
              style={{ fontSize: 16, color: "#1D1E1F" }}
            />
          </div>
          <span className="flex-1 text-sm text-[#1D1E1F]">
            {t("common.help")}
          </span>
          <div className="text-sm text-[#B3ADAD]">{version}</div>
        </a>
      </div>
      {/* Menu items */}
      {showMessageCenter && (
        <div className="flex flex-col gap-1.5 py-1.5 border-t border-[#ECEDEE]">
          <MessageCenter
            externalOpen={messageCenterOpen}
            onExternalClose={() => setMessageCenterOpen(false)}
            anchor={
              <div
                onClick={() => setMessageCenterOpen(true)}
                className="h-8 px-3 flex items-center gap-2 rounded cursor-pointer hover:bg-[#ECEDEE] text-[#1D1E1F]"
              >
                <div className="flex items-center justify-center size-6">
                  <SvgIcon name="remind" size="16" />
                </div>
                <span className="flex-1 text-sm">{t("message.center")}</span>
                <Badge count={unreadCount} />
                <div className="text-[#B3ADAD]">
                  <RightOutlined style={{ fontSize: 14 }} />
                </div>
              </div>
            }
          />
        </div>
      )}

      {/* Logout */}
      <div className="flex flex-col gap-1.5 py-1.5 border-t border-[#ECEDEE]">
        <div
          className="h-8 px-3 flex items-center gap-2 rounded cursor-pointer hover:bg-[#ECEDEE] text-[#1D1E1F]"
          onClick={handleLogout}
        >
          <div className="flex items-center justify-center size-6">
            <LogoutOutlined style={{ fontSize: 14, color: "#1D1E1F" }} />
          </div>
          <span className="text-sm">{t("action.logout")}</span>
        </div>
      </div>

    </>
  );

  return (
    <>
      <Tooltip
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            showMessageCenter && setMessageCenterOpen(false)
          }
          setTimeout(() => {
            setOpen(isOpen);
          }, 0)
          if (isOpen) handleShow();
        }}
        placement={placement}
        title={content}
        trigger="click"
        color="white"
        classNames={{
          container: "w-[300px]",
        }}
      >
        {children}
      </Tooltip>
      <GeneralSettingsModal
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
      />
    </>
  );
}

export default ProfilePopover;
