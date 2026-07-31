import { Menu } from "antd";
import {
    LeftOutlined
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useMemo, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import { SvgIcon } from "@km/shared-components-react";

const MENU_KEYS = [
    "basic-info",
    "members",
    "knowledge",
    "knowledge-graph",
    "dynamic",
    "recycle",
] as const;

interface MenuItemConfig {
    key: (typeof MENU_KEYS)[number];
    labelKey: string;
    icon: React.ReactNode;
}

const MENU_ITEMS: MenuItemConfig[] = [
    { key: "basic-info", labelKey: "space.setting.menu.basicInfo", icon: <SvgIcon name="book-one" /> },
    { key: "members", labelKey: "space.setting.menu.members", icon: <SvgIcon name="peoples" /> },
    { key: "knowledge", labelKey: "space.setting.menu.knowledge", icon: <SvgIcon name="app-one" /> },
    // { key: "knowledge-graph", labelKey: "space.setting.menu.knowledgeGraph", icon: <PartitionOutlined /> },
    // { key: "dynamic", labelKey: "space.setting.menu.dynamic", icon: <ThunderboltOutlined /> },
    // { key: "recycle", labelKey: "space.setting.menu.recycle", icon: <DeleteOutlined /> },
];

const MENU_LABEL_KEYS: Record<(typeof MENU_KEYS)[number], string> = {
    "basic-info": "space.setting.menu.basicInfo",
    members: "space.setting.menu.members",
    knowledge: "space.setting.menu.knowledge",
    "knowledge-graph": "space.setting.menu.knowledgeGraph",
    dynamic: "space.setting.menu.dynamic",
    recycle: "space.setting.menu.recycle",
};

export interface SettingSiderProps {
    space: SpaceItem | null;
    className?: string;
}

export function SettingSider({ space, className }: SettingSiderProps) {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const location = useLocation();

    const currentKey = useMemo(() => {
        const parts = location.pathname.split("/");
        const last = parts[parts.length - 1];
        return (MENU_KEYS as readonly string[]).includes(last) ? last : "basic-info";
    }, [location.pathname]);

    const handleMenuClick: MenuProps["onClick"] = useCallback(
        ({ key }) => {
            if (!id) return;
            navigate(`/space/${id}/setting/${key}`, { replace: true });
        },
        [id, navigate],
    );

    const handleBack = useCallback(() => {
        navigate(`/knowledge`);
    }, [navigate]);

    return (
        <div
            className={`w-[232px] h-full pt-5 px-4 bg-[#F8F9FA] flex-none ${className || ""}`}
        >
            {/* Header: back + logo + name */}
            <div className="h-9 flex items-center gap-1.5">
                <div
                    className="flex items-center justify-center size-6 cursor-pointer rounded hover:bg-[#E5E5E5]"
                    onClick={handleBack}
                >
                    <LeftOutlined />
                </div>
                {space?.icon ? (
                    <img
                        src={space.icon}
                        alt={space?.name || ""}
                        className="size-7 rounded-full"
                        onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = getPublicPath(
                                "/images/default_agent.png",
                            );
                        }}
                    />
                ) : (
                    <div className="size-7 rounded-full bg-[#E0EEFF] flex items-center justify-center text-xs text-brand">
                        {(space?.name || "?").charAt(0)}
                    </div>
                )}
                <p className="truncate text-sm">{space?.name || "--"}</p>
            </div>

            {/* Title */}
            <h2 className="h-9 flex items-center px-2 mt-5 mb-2.5 text-lg text-[#1D1E1F]">
                {t("space.setting.title")}
            </h2>

            {/* Menu */}
            <Menu
                mode="vertical"
                selectedKeys={[currentKey]}
                onClick={handleMenuClick}
                style={{ border: "none", background: "#F6F7F8" }}
                items={MENU_ITEMS.map((item) => ({
                    key: item.key,
                    icon: item.icon,
                    label: t(MENU_LABEL_KEYS[item.key]),
                }))}
            />
        </div>
    );
}

// Backward-compat: keep default export and unused-icon import (EditOutlined used by other entry)
export default SettingSider;
