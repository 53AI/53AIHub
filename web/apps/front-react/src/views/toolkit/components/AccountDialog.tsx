import { useState, forwardRef, useImperativeHandle } from "react";
import { Modal, Button, Spin, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { t } from "@/locales";
import linksApi from "@/api/modules/links";
import "./AccountDialog.css";

interface AccountDialogProps {
  onVisit?: () => void;
}

export interface AccountDialogRef {
  open: (item: { id: number | string; url: string }) => Promise<void>;
  close: () => void;
}

const AccountDialog = forwardRef<AccountDialogRef, AccountDialogProps>(
  (_, ref) => {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [accountList, setAccountList] = useState<any[]>([]);
    const [url, setUrl] = useState("");

    const open = async (item: { id: number | string; url: string }) => {
      setVisible(true);
      setLoading(true);
      setUrl(item.url);
      try {
        const info = await linksApi.detail(item.id);
        setAccountList(JSON.parse(info.data.shared_account));
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    };

    const close = () => {
      setVisible(false);
    };

    const handleVisit = () => {
      window.open(url, "_blank");
    };

    const handleCopy = async (text: string) => {
      try {
        await copyToClip(text);
        message.success(t("action.copy_success"));
      } catch (error) {
        message.error(t("action.copy_failed"));
      }
    };

    useImperativeHandle(ref, () => ({
      open,
      close,
    }));

    return (
      <Modal
        open={visible}
        onCancel={close}
        title={t("toolbox.account_access")}
        width={600}
        centered
        className="account-share-modal"
        footer={
          <>
            <Button type="primary" onClick={handleVisit}>
              {t("toolbox.click_access")}
            </Button>
            <Button onClick={close}>{t("action.cancel")}</Button>
          </>
        }
      >
        <div className="text-[#999999] sm:hidden">
          {t("toolbox.account_text2")}
        </div>
        <div className="text-[#999999] max-sm:hidden">
          {t("toolbox.account_text")}
        </div>

        <Spin spinning={loading}>
          <div className="max-h-72 min-h-28 overflow-y-auto flex flex-col gap-3 mt-4">
            {accountList.map((item, index) => (
              <div
                key={index}
                className="bg-[#F2F7FF] flex flex-col gap-5 p-5 rounded"
              >
                <div className="flex">
                  <span className="text-[#999999] flex-none w-14">
                    {t("form.account")}
                  </span>
                  <span className="text-[#1D1E1F] break-words whitespace-pre-wrap min-w-0">
                    {item.account}
                  </span>
                  <Button
                    color="primary"
                    variant="link"
                    onClick={() => handleCopy(item.account)}
                    className="ml-1 p-0 h-6"
                  >
                    <SvgIcon name="copy" size={14} />
                  </Button>
                </div>
                <div className="flex">
                  <span className="text-[#999999] flex-none w-14">
                    {t("form.password")}
                  </span>
                  <span className="text-[#1D1E1F] break-words whitespace-pre-wrap min-w-0">
                    {item.password}
                  </span>
                  <Button
                    color="primary"
                    variant="link"
                    onClick={() => handleCopy(item.password)}
                    className="ml-1 p-0 h-6"
                  >
                    <SvgIcon name="copy" size={14} />
                  </Button>
                </div>
                {item.remark && (
                  <div className="flex">
                    <span className="text-[#999999] flex-none w-14">
                      {t("form.remark")}
                    </span>
                    <span className="text-[#1D1E1F] flex-1 break-words whitespace-pre-wrap min-w-0">
                      {item.remark}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Spin>
      </Modal>
    );
  },
);

AccountDialog.displayName = "AccountDialog";

export default AccountDialog;
