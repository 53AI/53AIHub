import { Drawer } from "antd";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";
import type { SpaceItem } from "@/api/modules/spaces/types";
import { KnowledgeList } from "./KnowledgeList";
import { t } from "@/locales";

export interface KnowledgeListDrawerRef {
    open: (data: SpaceItem) => void;
    close: () => void;
}

function KnowledgeListDrawerInner(
    _: {},
    ref: React.ForwardedRef<KnowledgeListDrawerRef>,
) {
    const [visible, setVisible] = useState(false);
    const [spaceId, setSpaceId] = useState("");

    const open = useCallback((data: SpaceItem) => {
        setSpaceId(data.id);
        setVisible(true);
    }, []);

    const close = useCallback(() => setVisible(false), []);

    useImperativeHandle(ref, () => ({ open, close }), [open, close]);

    return (
        <Drawer
            open={visible}
            title={t("knowledge.name")}
            onClose={close}
            styles={{ wrapper: { width: "50%" } }}
        >
            {visible && spaceId ? <KnowledgeList spaceId={spaceId} /> : null}
        </Drawer>
    );
}

export const KnowledgeListDrawer = forwardRef<KnowledgeListDrawerRef>(
    KnowledgeListDrawerInner,
);

export default KnowledgeListDrawer;
