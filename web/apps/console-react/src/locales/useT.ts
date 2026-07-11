import { useMemo } from "react";
import { useLocaleStore } from "@/stores/modules/locale";

/**
 * Hook that returns a t function bound to current locale.
 * Components using this hook will re-render when locale changes.
 */
export function useT() {
  const locale = useLocaleStore((state) => state.locale);

  return useMemo(() => {
    return (key: string, params?: Record<string, unknown>): string => {
      // Import t dynamically to ensure it uses the latest locale
      const { t } = require("@/locales");
      return t(key, params);
    };
  }, [locale]);
}

export default useT;
