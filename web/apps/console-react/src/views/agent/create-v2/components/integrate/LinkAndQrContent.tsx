import { useState } from "react";
import {
  CopyOutlined,
  DownloadOutlined,
  InfoCircleOutlined
} from "@ant-design/icons";
import { message, Checkbox, InputNumber, Tooltip } from "antd";
import { QRCodeSVG } from "qrcode.react";
import { getPublicPath } from '@/utils/config';
import { useEnv } from "@/hooks/useEnv";
import { copyToClip, downloadSvgAsImage } from "@km/shared-utils";
import { t } from "@/locales";

interface LinkAndQrContentProps {
  agentId?: string | number;
  fixedToken?: string;
}

export const LinkAndQrContent = ({ agentId, fixedToken }: LinkAndQrContentProps) => {
  const { getFrontBaseUrl } = useEnv();
  const [enableTimeout, setEnableTimeout] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(20);

  const frontBaseUrl = getFrontBaseUrl();


  const buildUrl = (withTimeout: boolean = false) => {
    let url = `${frontBaseUrl}/agentplugin?token=${fixedToken}`

    if (withTimeout && enableTimeout && timeoutMinutes) {
      url += `&timeout=${timeoutMinutes * 60}`;
    }
    return url;
  };

  const agentPluginUrl = buildUrl(true);

  const handleCopy = async (text: string) => {
    const success = await copyToClip(text);
    if (success) {
      message.success(t('action_copy_success'));
    } else {
      message.error(t('action_save_failed'));
    }
  };

  const handleDownloadQr = () => {
    const svgElement = document.querySelector("#qrcode-svg") as SVGElement;
    if (svgElement) {
      downloadSvgAsImage(svgElement, `agent-${agentId || 'qr'}.png`, 200, 200);
    }
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-base font-semibold mb-5 text-primary">{t('integrate.link_qr')}</h2>

      <div className="mb-6">
        <div className="text-sm text-secondary mb-3">{t('integrate.style_example')}</div>
        <img className="h-[315px] w-auto" src={getPublicPath("/images/agent/access-link-example.png")} alt="" />
      </div>

      <div className="mb-6">
        <div className="text-sm text-secondary mb-3">{t('integrate.use_link')}</div>
        <div className="flex items-center max-w-2xl bg-gray-50 border border-gray-200 rounded-lg overflow-hidden group hover:border-blue-300 transition-colors">
          <input
            type="text"
            readOnly
            value={agentPluginUrl}
            className="flex-1 bg-transparent px-4 py-2 text-sm text-gray-600 outline-none"
          />
          <button
            className="px-4 py-2 text-gray-400 hover:text-blue-500 hover:bg-gray-100 transition-colors"
            onClick={() => handleCopy(agentPluginUrl)}
          >
            <CopyOutlined />
          </button>
        </div>
        <div className="h-8 flex items-center text-secondary text-sm gap-2 mt-4">
          <Checkbox
            checked={enableTimeout}
            onChange={(e) => setEnableTimeout(e.target.checked)}
          >
            {t('integrate.enable_session_timeout')}
          </Checkbox>
          {enableTimeout && (
            <>
              <span>，{t('integrate.timeout')}</span>
              <InputNumber
                min={10}
                max={10080}
                value={timeoutMinutes}
                onChange={(val) => setTimeoutMinutes(val || 30)}
              />
              <span>{t('integrate.minute')}</span>
              <Tooltip title={t('integrate.timeout_tooltip')} placement="right">
                <InfoCircleOutlined />
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="text-sm text-secondary mb-3">{t('integrate.qrcode')}</div>
        <div className="flex items-end gap-4">
          <div className="w-32 h-32 border border-gray-200 rounded-lg p-2 bg-white flex items-center justify-center">
            {agentId && fixedToken ? (
              <QRCodeSVG
                id="qrcode-svg"
                value={agentPluginUrl}
                size={120}
                level="H"
              />
            ) : (
              <div className="text-xs text-gray-400 text-center">
                {t('integrate.please_save_agent')}
              </div>
            )}
          </div>
          <button
            className="text-blue-500 hover:text-blue-600 text-sm flex items-center gap-1 mb-1 px-3 py-1.5 rounded border border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleDownloadQr}
            disabled={!agentId || !fixedToken}
          >
            <DownloadOutlined /> {t('integrate.download')}
          </button>
        </div>
      </div>
    </div>
  );
};
