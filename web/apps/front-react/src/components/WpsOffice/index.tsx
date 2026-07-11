import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { wpsApi } from "@/api/modules/wps";
import loadLib from "@/utils/loadLib";
import "./wps-office.css";

// Declare global types
declare global {
  interface Window {
    WebOfficeSDK: {
      init: (config: any) => IWps;
      OfficeType: {
        Writer: string;
        Spreadsheet: string;
        Presentation: string;
        Pdf: string;
      };
    };
  }
}

interface IWps {
  ready: () => void;
  destroy: () => void;
  save: () => void;
}

interface WpsOfficeRef {
  save: () => Promise<void>;
}

interface WpsOfficeProps {
  fileId: string;
  fileExt: string;
  appId: string;
  readonly?: boolean;
}

export const WpsOffice = forwardRef<WpsOfficeRef, WpsOfficeProps>(
  ({ fileId, fileExt, appId, readonly = false }, ref) => {
    const wpsOfficeRef = useRef<HTMLDivElement>(null);
    const wpsOfficeInstanceRef = useRef<IWps | null>(null);

    const initWpsOffice = async () => {
      const { ticket } = await wpsApi.ticket();
      const data: any = {
        officeType: "",
        appId,
        fileId,
        token: localStorage.getItem("access_token"),
        mount: wpsOfficeRef.current,
        mode: readonly ? "simple" : "nomal",
        customArgs: {
          tk: ticket,
        },
      };

      if (readonly) {
        data.customArgs.readonly = true;
      }

      if (["docx", "doc"].includes(fileExt)) {
        data.officeType = window.WebOfficeSDK.OfficeType.Writer;
      } else if (["xlsx", "xls"].includes(fileExt)) {
        data.officeType = window.WebOfficeSDK.OfficeType.Spreadsheet;
      } else if (["pptx", "ppt"].includes(fileExt)) {
        data.officeType = window.WebOfficeSDK.OfficeType.Presentation;
      } else if (["pdf"].includes(fileExt)) {
        data.officeType = window.WebOfficeSDK.OfficeType.Pdf;
      }

      wpsOfficeInstanceRef.current = window.WebOfficeSDK.init(data);
      wpsOfficeInstanceRef.current.ready();
    };

    useEffect(() => {
      let isDestroyed = false;

      loadLib("weboffice").then(() => {
        if (!isDestroyed) {
          initWpsOffice();
        }
      });

      return () => {
        isDestroyed = true;
        if (wpsOfficeInstanceRef.current) {
          try {
            wpsOfficeInstanceRef.current.destroy();
          } catch (e) {
            console.warn("WPS destroy error:", e);
          }
          wpsOfficeInstanceRef.current = null;
        }
        // Clear the container to remove any leftover iframe/elements
        if (wpsOfficeRef.current) {
          wpsOfficeRef.current.innerHTML = "";
        }
      };
    }, []);

    useImperativeHandle(ref, () => ({
      save: async () => {
        if (wpsOfficeInstanceRef.current && wpsOfficeInstanceRef.current.save) {
          await wpsOfficeInstanceRef.current.save();
        }
      },
    }));

    return <div ref={wpsOfficeRef} className="wps-office-container" />;
  },
);

export default WpsOffice;
