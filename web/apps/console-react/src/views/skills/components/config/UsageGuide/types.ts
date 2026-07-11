import type { QualityScore, UsageItem } from "../../../utils/usageValidation";

export type { QualityScore, UsageItem };

export interface UsageSwitches {
  quality_scores: boolean;
  capabilities: boolean;
  usage_example: boolean;
  best_practice: boolean;
  faq: boolean;
}

export interface UsageItems {
  quality_scores: QualityScore[];
  capabilities: UsageItem[];
  usage_example: UsageItem[];
  bestPracticesPositive: UsageItem[];
  bestPracticesNegative: UsageItem[];
  faq: UsageItem[];
}

export interface UsageGuideRef {
  getUsageData: () => { usageSwitches: UsageSwitches; usageItems: UsageItems };
  setUsageData: (usageSwitches: UsageSwitches, usageItems: UsageItems) => void;
  validate: () => { valid: boolean; message?: string };
  buildUsageGuide: () => string;
  isUnSaved: () => boolean;
}

export interface UsageOption {
  key: keyof UsageSwitches;
  title: string;
  svgIcon: string;
  svgColor?: string;
  iconBg: string;
  description: string;
}
