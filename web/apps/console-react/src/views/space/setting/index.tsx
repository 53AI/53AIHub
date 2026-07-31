import { useCallback, useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { Spin } from "antd";
import { spacesApi } from "@/api/modules/spaces";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { SettingSider } from "./sider";
import { t } from "@/locales";

export interface SpaceSettingContext {
    space: SpaceItem;
    reload: () => Promise<void>;
}

export function SpaceSettingLayout() {
    const { id } = useParams<{ id: string }>();
    const [space, setSpace] = useState<SpaceItem | null>(null);
    const [loading, setLoading] = useState(true);

    const loadSpace = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const res = await spacesApi.detail(id);
            setSpace(res as SpaceItem);
        } catch (error) {
            console.error("Load space detail error:", error);
            setSpace(null);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        loadSpace();
    }, [loadSpace]);

    return (
        <div className="w-screen h-screen flex overflow-hidden">
            <SettingSider space={space} />
            {loading && (
                <div className="flex-1 flex items-center justify-center">
                    <Spin />
                </div>
            )}
            {!loading && !space && (
                <div className="flex-1 flex items-center justify-center text-hint">
                    {t("message_status.load_failed")}
                </div>
            )}
            {!loading && space && (
                <div className="flex-1">
                    <Outlet
                        context={{ space, reload: loadSpace } satisfies SpaceSettingContext}
                    />
                </div>
            )}
        </div>
    );
}

export default SpaceSettingLayout;
