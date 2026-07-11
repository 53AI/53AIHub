import { Modal } from "antd";
import { PhoneFilled } from "@ant-design/icons";
import { t } from "@/locales";

export interface ServiceDialogProps {
  open?: boolean;
  title?: string;
  onClose?: () => void;
}

export function ServiceDialog({
  open = false,
  title,
  onClose,
}: ServiceDialogProps) {
  return (
    <Modal
      open={open}
      title={title || t("service.title")}
      onCancel={onClose}
      footer={null}
      width={520}
      className="service-dialog"
      styles={{
        body: { padding: "30px 0 0" },
        container: { padding: 0 },
        header: { paddingTop: 20, paddingLeft: 20 },
        title: { fontSize: 22 },
      }}
    >
      <div className="consult">
        <div
          className="consult-info"
          style={{ display: "flex", marginBottom: 30, padding: "0 38px" }}
        >
          <div className="w-[70px] h-[70px] rounded-full bg-white flex justify-center items-center">
            <img
              className="w-[50px] h-[50px]"
              src="https://chat.53ai.com/images/extension_icon.png"
              alt="service"
            />
          </div>
          <div style={{ marginLeft: 20 }}>
            <p style={{ fontSize: 24, fontWeight: 500, marginBottom: 10 }}>
              {t("service.consult_name")}
            </p>
            <div className="flex items-center">
              <PhoneFilled style={{ fontSize: 16, color: "#0082f0" }} />
              <span style={{ color: "#666", marginLeft: 5, fontSize: 18 }}>
                186 8888 1185
              </span>
            </div>
          </div>
        </div>

        <div
          className="consult-ft"
          style={{
            padding: "30px 50px",
            height: 125,
            backgroundColor: "#0082f0",
            borderRadius: "0 0 10px 10px",
            color: "#fff",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              backgroundColor: "#0082f0",
              transform: "rotate(45deg)",
              position: "absolute",
              top: -10,
              left: 125,
            }}
          />
          <p className="max-w-64" style={{ lineHeight: "24px" }}>
            <span style={{ fontSize: 15 }}>"</span>
            {t("service.desc_3") + t("version.upgrade_renew")}
            <span style={{ fontSize: 15 }}>"</span>
          </p>
        </div>

        <div
          className="consult-img"
          style={{
            width: 104,
            height: 104,
            background: "#fff",
            padding: 2,
            boxShadow: "1px 1px 2px 0 rgb(7 116 208 / 20%)",
            borderRadius: 4,
            position: "absolute",
            bottom: 50,
            right: 30,
          }}
        >
          <img
            src="https://hub.53ai.com/console/images/upgrade-qrcode.png"
            alt="qrcode"
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </div>
    </Modal>
  );
}

export default ServiceDialog;
