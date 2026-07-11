import { useMemo } from "react";
import { Empty, Tooltip, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import { useTranslation } from "../i18n";

const DEFAULT_IMG = "/images/default_agent.png";

interface UseCase {
  type: "case" | "scene" | "channel";
  input_text?: string;
  output_text?: string;
  image?: string;
  scene?: string;
  desc?: string;
  name?: string;
}

export interface UsageGuideProps {
  useCases?: string | UseCase[];
  defaultImage?: string;
  showChannel?: boolean;
  plain?: boolean;
}

function UsageGuide({ useCases, defaultImage = DEFAULT_IMG, showChannel = false, plain = false }: UsageGuideProps) {
  const { t } = useTranslation();

  const { cases, scenes, channels } = useMemo(() => {
    let list: UseCase[] = [];
    try {
      if (useCases) {
        // 支持字符串和数组两种类型
        list = typeof useCases === 'string' ? JSON.parse(useCases) || [] : useCases;
      }
    } catch {
      list = [];
    }
    return {
      cases: list.filter((item) => item.type === "case"),
      scenes: list.filter((item) => item.type === "scene"),
      channels: list.filter((item) => item.type === "channel"),
    };
  }, [useCases]);

  const handleCopy = async (text: string) => {
    try {
      await copyToClip(text);
      message.success(t("action.copy_success") || "复制成功");
    } catch (err) {
      message.error(t("action.copy_failed") || "复制失败");
    }
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    if (target.src.endsWith(defaultImage)) return;
    target.src = defaultImage;
  };


  return (
    <div className={`${ plain ? '' : 'h-[calc(100%-70px)] overflow-y-auto bg-white' }`}>
      <div className={`${ plain ? 'bg-white' : 'p-6 bg-white rounded' }`}>
        <h4 className="text-base text-[#1F2123]">{t("chat.usage_case")}</h4>
        <div className="columns-2 gap-5 space-y-5 mt-5 max-md:columns-1">
          {cases.map((item, index) => (
            <div
              key={index}
              className="p-5 bg-[#F7F9FC] rounded relative group cursor-pointer break-inside-avoid"
            >
              <div className="bg-white rounded p-5 relative">
                <div className="text-sm text-[#909193]">{t("chat.input")}</div>
                <div className="text-sm text-[#1F2123] break-words mt-4">
                  {item.input_text}
                </div>
                <div className="absolute right-8 -bottom-9">
                  <SvgIcon name="arrow-down" size={50} color="white" />
                </div>
              </div>
              <div className="bg-[#E6EEFF] rounded p-5 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-[#909193]">{t("chat.output")}</div>
                  <Tooltip title={t("action.copy")}>
                    <div
                      className="cursor-pointer"
                      onClick={() => handleCopy(item.output_text || "")}
                    >
                      <SvgIcon name="copy" color="#4F5052" />
                    </div>
                  </Tooltip>
                </div>
                <div className="text-sm text-[#1F2123] break-words whitespace-pre-wrap mt-4">
                  {item.output_text}
                </div>
              </div>
            </div>
          ))}
        </div>
        {cases.length === 0 && (
          <div className="flex items-center justify-center">
            <Empty
              image="/images/chat/completion_empty.png"
              description={t("common.no_data")}
            />
          </div>
        )}
      </div>
      <div className={`${ plain ? 'bg-white mt-6' : 'p-6 bg-white rounded' }`}>
        <h4 className="text-base text-[#1F2123]">{t("chat.usage_scene")}</h4>
        <div className="flex gap-6 py-5 max-md:flex-col max-md:gap-2">
          {scenes.map((item, index) => (
            <div
              key={index}
              className="flex-1 px-4 text-center pt-3 pb-10 relative cursor-pointer group"
            >
              <img
                className="max-w-[200px] mx-auto"
                src={item.image}
                alt={item.scene}
                onError={handleImageError}
              />
              <h6 className="text-base text-[#1F2123] mt-5 break-words">
                {item.scene}
              </h6>
              <p className="text-xs text-[#909193] mt-4 break-words">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
        {scenes.length === 0 && (
          <div className="flex items-center justify-center">
            <Empty
              image="/images/chat/completion_empty.png"
              description={t("common.no_data")}
            />
          </div>
        )}
      </div>
      {showChannel && (
        <div className={`${ plain ? 'bg-white mt-6' : 'p-6 bg-white rounded' }`}>
          <h4 className="text-base text-[#1F2123]">{t("chat.usage_channel")}</h4>
          <div className="flex gap-6 py-5 max-md:flex-col max-md:gap-2">
            {channels.map((item, index) => (
              <div
                key={index}
                className="flex-1 px-4 text-center pt-3 pb-10 relative cursor-pointer group"
              >
                <img
                  className="max-w-[200px] mx-auto"
                  src={item.image}
                  alt={item.name}
                  onError={handleImageError}
                />
                <h6 className="text-base text-[#1F2123] mt-5 break-words">
                  {item.name}
                </h6>
                <p className="text-xs text-[#909193] mt-4 break-words">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
          {channels.length === 0 && (
            <div className="flex items-center justify-center">
              <Empty
                image="/images/chat/completion_empty.png"
                description={t("common.no_data")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default UsageGuide;
