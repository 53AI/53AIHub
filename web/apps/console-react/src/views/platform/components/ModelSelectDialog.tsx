import { useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { Drawer, Button } from "antd";
import { t } from "@/locales";
import type { ModelOption } from "@/api/modules/channel";

interface ModelSelectDialogProps {
  list?: any[];
  modelList?: ModelOption[];
  onAdd: (opt: ModelOption) => void;
}

export interface ModelSelectDialogRef {
  open: () => void;
  close: () => void;
}

export const ModelSelectDialog = forwardRef<
  ModelSelectDialogRef,
  ModelSelectDialogProps
>(({ list = [], modelList = [], onAdd }, ref) => {
  const [visible, setVisible] = useState(false);

  const channelOptions = useMemo(() => {
    if (!Array.isArray(modelList)) return [];
    return modelList.map((item) => ({
      ...item,
      isAdd:
        Array.isArray(list) &&
        list.some((a: any) => a.channel_type === item.channel_type),
    }));
  }, [modelList, list]);

  const handleAdd = (opt: ModelOption & { isAdd: boolean }) => {
    onAdd(opt);
    setVisible(false);
  };

  useImperativeHandle(
    ref,
    () => ({
      open: () => setVisible(true),
      close: () => setVisible(false),
    }),
    [],
  );

  return (
    <Drawer
      open={visible}
      title={t("module.platform_model_add")}
      onClose={() => setVisible(false)}
      destroyOnHidden
      mask={{ closable: false }}
      styles={{ wrapper: { width: 700 } }}
    >
      <ul className="flex flex-col gap-3">
        {channelOptions.map((opt) => (
          <li
            key={opt.platform_id}
            className="h-[72px] flex items-center gap-4 py-5 px-6 rounded bg-[#F8F9FA]"
          >
            <img
              className="flex-none w-10 h-10 object-contain"
              src={opt.platform_icon}
              alt=""
            />
            <div className="flex-1 text-dark font-semibold">
              {opt.platform_name}
            </div>
            <Button
              className="flex-none !border-none"
              color="primary"
              variant="filled"
              disabled={opt.isAdd}
              onClick={() => handleAdd(opt as any)}
            >
              {t(opt.isAdd ? "action_add_success" : "action_add")}
            </Button>
          </li>
        ))}
      </ul>
    </Drawer>
  );
});

export default ModelSelectDialog;
