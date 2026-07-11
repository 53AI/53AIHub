import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Select, Switch, InputNumber, Input, Form } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import platformSettingsApi from "@/api/modules/platform-settings";
import { transformPlatformSetting } from "@/api/modules/platform-settings/transform";
import type { PlatformSetting } from "@/api/modules/platform-settings/types";
import {
  getSimpleParserConfigs,
  PARSER_BUSINESS_OPTIONS,
} from "@/constants/parser";
import "./ParseConfig.css";

interface ParseConfigProps {
  config: any;
  onChange?: (config: any) => void;
}

export function ParseConfig({ config, onChange }: ParseConfigProps) {
  // Use ref to store parserConfigs to prevent infinite re-renders
  const parserConfigsRef = useRef(getSimpleParserConfigs());
  const parserConfigs = parserConfigsRef.current;

  const [settingsMap, setSettingsMap] = useState<
    Record<string, PlatformSetting | null>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Track if initial load is done
  const initializedRef = useRef(false);

  const activeMethodOptions = useMemo(() => {
    return PARSER_BUSINESS_OPTIONS[config.engine] || [];
  }, [config.engine]);

  // Initialize default values when engine changes
  useEffect(() => {
    if (!config.engine) return;
    const options = PARSER_BUSINESS_OPTIONS[config.engine] || [];
    const updates: Record<string, any> = {};
    options.forEach((opt: any) => {
      if (config[opt.key] === undefined && opt.defaultValue !== undefined) {
        updates[opt.key] = opt.defaultValue;
      }
    });
    if (Object.keys(updates).length > 0) {
      onChange?.({ ...config, ...updates });
    }
  }, [config.engine, config, onChange]);

  const loadAllParserSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await platformSettingsApi.find();
      const newSettingsMap: Record<string, PlatformSetting | null> = {};
      res.forEach((item) => {
        if (parserConfigs.find((c) => c.key === item.platform_key)) {
          newSettingsMap[item.platform_key] = transformPlatformSetting(item);
        }
      });
      setSettingsMap(newSettingsMap);
      // Update scroll buttons after data loads
      setTimeout(updateScrollButtons, 0);
    } catch (error) {
      console.error("Failed to load parser settings:", error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Remove parserConfigs dependency to prevent infinite loop

  // Only load once on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    loadAllParserSettings();
  }, [loadAllParserSettings]);

  const parseMethods = useMemo(() => {
    return parserConfigs
      .filter((c) => c.key === "default" || settingsMap[c.key])
      .map((c) => ({
        key: c.key === "default" ? "markitdown" : c.key,
        name: c.name,
        desc: c.desc || "由系统提供的解析服务",
        icon: c.icon,
        detailedDesc: c.detailedDesc,
      }));
  }, [parserConfigs, settingsMap]);

  // Auto-select default engine after settings loaded
  // Only if current engine is not in the available parseMethods
  useEffect(() => {
    if (isLoading) return;
    const engineExists = parseMethods.some((m) => m.key === config.engine);
    if (!engineExists) {
      onChange?.({ ...config, engine: parseMethods[0].key });
    }
  }, [parseMethods, config.engine, isLoading]);

  // Whether to show navigation buttons (show when more than 4)
  const showNavigation = useMemo(
    () => parseMethods.length > 4,
    [parseMethods.length],
  );

  // Update scroll button status
  const updateScrollButtons = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const scrollLeftPos = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;

    setCanScrollLeft(scrollLeftPos > 0);
    setCanScrollRight(scrollLeftPos < scrollWidth - clientWidth - 1);
  }, []);

  // Watch for parse method list changes
  useEffect(() => {
    updateScrollButtons();
  }, [parseMethods.length, updateScrollButtons]);

  // Scroll left
  const scrollLeft = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const itemWidth = 229 + 16; // Card width + gap
    container.scrollBy({ left: -itemWidth * 2, behavior: "smooth" });
    setTimeout(updateScrollButtons, 300);
  };

  // Scroll right
  const scrollRight = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const itemWidth = 229 + 16; // Card width + gap
    container.scrollBy({ left: itemWidth * 2, behavior: "smooth" });
    setTimeout(updateScrollButtons, 300);
  };

  // Handle scroll
  const handleScroll = () => {
    updateScrollButtons();
  };

  const activeMethodInfo = useMemo(() => {
    return parseMethods.find((m) => m.key === config.engine);
  }, [parseMethods, config.engine]);

  const getMethodName = (key: string) => {
    return parseMethods.find((m) => m.key === key)?.name || key;
  };

  // Helper to update config
  const updateConfig = (key: string, value: any) => {
    onChange?.({ ...config, [key]: value });
  };

  const renderConfigField = (opt: any) => {
    switch (opt.type) {
      case "switch":
        return (
          <Switch
            checked={config[opt.key]}
            onChange={(val) => updateConfig(opt.key, val)}
          />
        );
      case "select":
        return (
          <Select
            value={config[opt.key]}
            onChange={(val) => updateConfig(opt.key, val)}
            className="w-full custom-select"
            mode={opt.multiple ? "multiple" : undefined}
            options={opt.options?.map((op: any) => ({
              label: op.label,
              value: op.value,
            }))}
          />
        );
      case "number":
        return (
          <InputNumber
            value={config[opt.key]}
            onChange={(val) => updateConfig(opt.key, val)}
            min={opt.min}
            max={opt.max}
            className="w-full"
            controls={false}
            placeholder={opt.placeholder}
          />
        );
      default:
        return (
          <Input
            value={config[opt.key]}
            onChange={(e) => updateConfig(opt.key, e.target.value)}
            className="w-full"
            placeholder={opt.placeholder}
          />
        );
    }
  };

  return (
    <div className="parse-config-container space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Parse method selection area */}
      <div className="relative">
        {/* Left arrow button */}
        {showNavigation && (
          <button
            disabled={!canScrollLeft}
            className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all ${
              !canScrollLeft ? "opacity-30 cursor-not-allowed" : ""
            }`}
            onClick={scrollLeft}
          >
            <SvgIcon name="arrow-left" size={20} className="text-gray-600" />
          </button>
        )}

        {/* Scroll container */}
        <div
          ref={scrollContainerRef}
          className="p-2 flex gap-4 overflow-x-hidden scroll-smooth parse-config-scroll"
          onScroll={handleScroll}
        >
          {parseMethods.map((method) => (
            <div
              key={method.key}
              className={`flex-shrink-0 w-[229px] p-4 rounded-xl outline outline-1 outline-offset-[-1px] transition-all cursor-pointer relative ${
                config.engine === method.key
                  ? "outline-[#2563EB] ring-4 outline-2 ring-blue-50"
                  : "outline-[#E6E8EBFF] hover:border-gray-200"
              }`}
              onClick={() => updateConfig("engine", method.key)}
            >
              {config.engine === method.key && (
                <div className="absolute top-0 right-0">
                  <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl" />
                  <CheckOutlined
                    className="absolute top-1 right-1 text-white"
                    style={{ fontSize: 10 }}
                  />
                </div>
              )}
              <div className="w-[50px] h-[50px] mb-4 rounded overflow-hidden">
                <img
                  src={method.icon}
                  className="w-full h-full object-cover"
                  alt={method.name}
                />
              </div>
              <div className="text-base font-semibold text-[#1D1E1F] mb-1">
                {method.name}
              </div>
              <div className="text-sm text-[#9A9A9A] leading-normal">
                {method.desc}
              </div>
            </div>
          ))}
        </div>

        {/* Right arrow button */}
        {showNavigation && (
          <button
            disabled={!canScrollRight}
            className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all ${
              !canScrollRight ? "opacity-30 cursor-not-allowed" : ""
            }`}
            onClick={scrollRight}
          >
            <SvgIcon name="arrow-right" size={20} className="text-gray-600" />
          </button>
        )}
      </div>

      {/* Specific method configuration */}
      {config.engine && (
        <div className="bg-gray-50/50 rounded-2xl p-6 border border-gray-100 space-y-6">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <SvgIcon name="settings" className="text-[#2563EB]" />
            <span>{getMethodName(config.engine)} 配置</span>
          </div>

          {/* Info Box */}
          <div className="bg-[#F0F4FF] p-4 rounded-xl flex items-start gap-3">
            <p className="text-xs text-[#999999] leading-relaxed">
              {activeMethodInfo?.detailedDesc}
            </p>
          </div>

          {config.engine !== "markitdown" && false && (
            <Form labelCol={{ span: 24 }} className="parse-config-form">
              {activeMethodOptions.length > 0 && (
                <div className="grid grid-cols-2 gap-5">
                  {activeMethodOptions.map((opt: any) => (
                    <React.Fragment key={opt.key}>
                      {opt.type === "switch" ? (
                        <div className="col-span-2 p-5 rounded-xl flex items-center justify-between bg-white border border-[#E6E8EB]">
                          <div>
                            <div className="text-sm font-bold text-gray-700">
                              {opt.label}
                            </div>
                            {opt.desc && (
                              <p className="text-xs text-gray-400 mt-1">
                                {opt.desc}
                              </p>
                            )}
                          </div>
                          {renderConfigField(opt)}
                        </div>
                      ) : (
                        <Form.Item label={opt.label} className="!mb-0">
                          {renderConfigField(opt)}
                        </Form.Item>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* 无特定配置的引擎的默认配置 */}
              {activeMethodOptions.length === 0 && (
                <div className="space-y-4 mt-6 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-gray-700">
                        扫描件增强
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        对纯图片型 PDF 启用轻量级 OCR
                      </p>
                    </div>
                    <Switch
                      checked={config.scan_enhance}
                      onChange={(val) => updateConfig("scan_enhance", val)}
                    />
                  </div>
                </div>
              )}
            </Form>
          )}
        </div>
      )}
    </div>
  );
}

export default ParseConfig;
