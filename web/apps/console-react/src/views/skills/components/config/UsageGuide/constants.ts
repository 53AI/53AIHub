import type { UsageOption } from "./types";
import { t } from "@/locales";

export const usageOptions: UsageOption[] = [
  {
    key: "quality_scores",
    title: t("skills.usage.quality_scores"),
    svgIcon: "lightning_v2",
    iconBg: "bg-[#EE770219]",
    description: t("skills.usage.quality_scores_desc"),
  },
  {
    key: "capabilities",
    title: t("skills.usage.capabilities"),
    svgIcon: "smile",
    iconBg: "bg-[#F9545419]",
    description: t("skills.usage.capabilities_desc"),
  },
  {
    key: "usage_example",
    title: t("skills.usage.usage_example"),
    svgIcon: "three-lines",
    iconBg: "bg-[#3B82F619]",
    description: t("skills.usage.usage_example_desc"),
  },
  {
    key: "best_practice",
    title: t("skills.usage.best_practice"),
    svgIcon: "bulb",
    iconBg: "bg-[#4F46E519]",
    description: t("skills.usage.best_practice_desc"),
  },
  {
    key: "faq",
    title: t("skills.usage.faq"),
    svgIcon: "question",
    svgColor: "#00BAAD",
    iconBg: "bg-[#14B8A619]",
    description: t("skills.usage.faq_desc"),
  },
];
