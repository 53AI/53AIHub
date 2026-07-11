import { useState, useEffect, useRef } from "react";
import { Modal } from "antd";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import ProfileView from "./userInfo/index";
import ProfileMemory, { type ProfileMemoryRef } from "./memory";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

type TabKey = "userinfo" | "memory";

const MENUS = [
  { key: "userinfo" as const, icon: "people", label: t("profile.user_info") },
  { key: "memory" as const, icon: "brain_v2", label: t("profile.user_memory") },
];

export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("userinfo");
  const enterpriseStore = useEnterpriseStore();
  const memoryRef = useRef<ProfileMemoryRef>(null);

  useEffect(() => {
    if (open) {
      enterpriseStore.loadInfo();
    }
  }, [open]);

  const handleClose = () => {
    // 检查用户记忆表单是否有未保存更改
    if (activeTab === "memory" && memoryRef.current?.hasUnsavedChanges()) {
      Modal.confirm({
        title: t("common.tip"),
        content: t("common.unsaved_changes"),
        okText: t("action.confirm"),
        cancelText: t("action.cancel"),
        onOk: () => {
          onClose();
        },
      });
    } else {
      onClose();
    }
  };

  const renderContent = () => {
    if (activeTab === "userinfo") {
      return <ProfileView />;
    }

    if (activeTab === "memory") {
      return <ProfileMemory ref={memoryRef} />;
    }

    return null;
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={1440}
      centered
      destroyOnClose
      className="profile-settings-modal"
      styles={{
        body: { padding: 0, height: "800px" },
        container: {
          borderRadius: "12px",
          overflow: "hidden",
        },
      }}
      style={{
        "--ant-modal-content-padding": 0,
      }}
    >
      <div className="flex h-full w-full">
        {/* Sidebar */}
        <div className="w-[200px] bg-[#F8FAFC] flex-shrink-0">
          <div className="text-base font-medium text-[#1D1E1F] my-4 px-5">
            {t("profile.setting")}
          </div>
          <div className="flex flex-col gap-1 px-4">
            {MENUS.map((menu) => (
              <div
                key={menu.key}
                onClick={() => setActiveTab(menu.key)}
                className={`h-8 flex items-center gap-2 px-3 rounded-lg cursor-pointer transition-colors text-[#373A3D] ${
                  activeTab === menu.key ? "bg-[#EFEFF0]" : ""
                }`}
              >
                <div className="size-4 flex-center">
                  <SvgIcon name={menu.icon} size={16} />
                </div>
                <span className="text-sm">{menu.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </Modal>
  );
}

export default ProfileModal;