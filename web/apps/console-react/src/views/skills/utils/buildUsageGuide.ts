import { generateRandomId } from "@km/shared-utils";
import type { UsageSwitches, UsageItems } from "../components/config/UsageGuide/types";

export const generateItemId = (): string => generateRandomId(9);

interface UsageGuideData {
  quality_scores?: Array<{ key: string; label: string; value: number }>;
  capabilities?: Array<{ title: string; description: string }>;
  usage_example?: Array<{ title: string; description: string }>;
  best_practice?: {
    positive: Array<{ title: string }>;
    negative: Array<{ title: string }>;
  };
  faq?: Array<{ title: string; description: string }>;
}

export const buildUsageGuide = (
  usageSwitches: UsageSwitches,
  usageItems: UsageItems
): string => {
  const usageGuide: UsageGuideData = {};

  if (usageSwitches.quality_scores) {
    usageGuide.quality_scores = usageItems.quality_scores.map((item) => ({
      key: item.key,
      label: item.label,
      value: item.value,
    }));
  }

  if (usageSwitches.capabilities) {
    usageGuide.capabilities = usageItems.capabilities
      .filter((item) => item.title.trim())
      .map((item) => ({ title: item.title, description: item.description }));
  }

  if (usageSwitches.usage_example) {
    usageGuide.usage_example = usageItems.usage_example
      .filter((item) => item.title.trim())
      .map((item) => ({ title: item.title, description: item.description }));
  }

  if (usageSwitches.best_practice) {
    usageGuide.best_practice = {
      positive: usageItems.bestPracticesPositive
        .filter((item) => item.title.trim())
        .map((item) => ({ title: item.title })),
      negative: usageItems.bestPracticesNegative
        .filter((item) => item.title.trim())
        .map((item) => ({ title: item.title })),
    };
  }

  if (usageSwitches.faq) {
    usageGuide.faq = usageItems.faq
      .filter((item) => item.title.trim())
      .map((item) => ({ title: item.title, description: item.description }));
  }

  return JSON.stringify(usageGuide);
};
