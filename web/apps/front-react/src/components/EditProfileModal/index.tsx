import { useEffect, useRef, useState } from "react";
import { Avatar, Input, Modal, Spin, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { CropperDialog, type CropperDialogRef } from "@/components/CropperDialog";
import { t } from "@/locales";

export interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功后的回调（全局弹窗用于解除后续自动弹出） */
  onSuccess?: () => void;
  /** 顶部提示文案，如「检测到昵称异常，请修改」 */
  alertText?: string;
  /** 弹窗标题，默认「编辑个人信息」 */
  title?: string;
}

/**
 * 编辑个人信息弹窗（头像 + 昵称）。
 * 同时被「个人信息页」和「登录后昵称异常提示」复用，避免两份实现。
 */
export function EditProfileModal({
  open,
  onClose,
  onSuccess,
  alertText,
  title,
}: EditProfileModalProps) {
  const userStore = useUserStore();
  const cropperRef = useRef<CropperDialogRef>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [form, setForm] = useState({ nickname: "", avatar: "" });

  // 每次打开都用最新的用户信息回填，避免上次残留
  useEffect(() => {
    if (!open) return;
    setForm({
      nickname: userStore.info.nickname || "",
      avatar: userStore.info.avatar || "",
    });
  }, [open, userStore.info.nickname, userStore.info.avatar]);

  const handleChangeAvatar = () => {
    if (avatarUploading) return;
    cropperRef.current?.uploadFile();
  };

  const handleCropperConfirm = (data: { url: string }) => {
    setForm((prev) => ({ ...prev, avatar: data.url }));
  };

  const handleSave = async () => {
    if (!form.nickname.trim()) return;
    await userStore.update(form);
    message.success(t("status.updated"));
    onClose();
    onSuccess?.();
  };

  return (
    <>
      <Modal
        open={open}
        title={title ?? t("action.edit") + t("profile.info")}
        onCancel={onClose}
        onOk={handleSave}
        okButtonProps={{
          disabled: !form.nickname.trim(),
          loading: avatarUploading,
        }}
      >
        {alertText && (
          <div className="mt-2 mb-4 px-3 py-2 rounded bg-[#FFF7E6] text-sm text-[#D46B08]">
            {alertText}
          </div>
        )}
        <div className="mt-4">
          <div className="w-[73px] text-regular text-opacity-80">
            {t("form.avatar")}
          </div>
          <div
            className="mt-3 relative rounded-full w-[60px] h-[60px] overflow-hidden cursor-pointer"
            onClick={handleChangeAvatar}
          >
            <Spin spinning={avatarUploading}>
              <Avatar size={60} src={form.avatar} />
            </Spin>
            {!avatarUploading && (
              <div className="absolute bottom-0 left-0 right-0 h-5 flex justify-center items-center bg-black/60 text-white/80 text-xs">
                {t("form.change")}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6">
          <div className="w-[73px] text-regular text-opacity-80">
            {t("form.nickname")}
          </div>
          <Input
            className="mt-3 flex-1"
            maxLength={15}
            showCount
            value={form.nickname}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, nickname: e.target.value }))
            }
          />
        </div>
      </Modal>
      <CropperDialog
        ref={cropperRef}
        onConfirm={handleCropperConfirm}
        onUploadingChange={setAvatarUploading}
        cropperDisabled
        limitSize={2}
      />
    </>
  );
}

export default EditProfileModal;
