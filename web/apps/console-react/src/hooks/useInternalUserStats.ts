import { useState, useEffect, useMemo, useCallback } from "react";
import { useEnterpriseStore } from "@/stores";
import { userApi } from "@/api/modules/user";
import { VERSION_MODULE } from "@/constants/enterprise";

export function useInternalUserStats() {
  const [internalUserCount, setInternalUserCount] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const enterpriseStore = useEnterpriseStore();

  const getModuleMax = useMemo(() => {
    const max = enterpriseStore.version?.features?.[VERSION_MODULE.INTERNAL_USER]?.max;
    return max && max !== -1 ? max : "∞";
  }, [enterpriseStore.version?.features]);

  const refreshCount = useCallback(() => {
    setRefreshVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { total } = await userApi.fetch_internal_user({
          keyword: "",
          offset: 0,
          limit: 0,
          from: 0,
          status: -1,
        });
        setInternalUserCount(total || 0);
      } catch (error) {
        console.error("Failed to load internal user count:", error);
      }
    };
    load();
  }, [refreshVersion]);

  return { internalUserCount, maxLimit: getModuleMax, refreshCount };
}
