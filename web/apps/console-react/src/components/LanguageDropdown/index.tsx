import { Dropdown } from "@km/shared-components-react";
import { DownOutlined } from "@ant-design/icons";
import { eventBus } from "@km/shared-utils";
import { SvgIcon } from "@km/shared-components-react";
import { useLocaleStore, type LocaleValue } from "@/stores/modules/locale";

const LANG_OPTIONS = [
  { label: "中文（简体）", value: "zh-cn" as LocaleValue },
  { label: "中文（繁體）", value: "zh-tw" as LocaleValue },
  { label: "English（US）", value: "en" as LocaleValue },
  { label: "日本語", value: "ja" as LocaleValue },
];

export function LanguageDropdown() {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  const currentLangLabel =
    LANG_OPTIONS.find((item) => item.value === locale)?.label || "";

  const handleLanguageChange = (lang: LocaleValue) => {
    setLocale(lang);

    // 触发语言变更事件
    eventBus.emit("language-change", lang);
  };

  const items = LANG_OPTIONS.map((item) => ({
    key: item.value,
    label: item.label,
    onClick: () => handleLanguageChange(item.value),
  }));

  return (
    <Dropdown menu={{ items }} trigger={["click"]}>
      <div className="outline-none border-none flex items-center gap-1 cursor-pointer">
        <SvgIcon name="language" />
        <span className="text-sm cursor-pointer">{currentLangLabel}</span>
        <DownOutlined style={{ fontSize: 12 }} />
      </div>
    </Dropdown>
  );
}

export default LanguageDropdown;
