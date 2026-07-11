import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Button, Empty, message, Modal, Spin } from "antd";
import "./platform.css";
import { t } from "@/locales";
import { getRealPath } from "@/utils/config";
import channelApi, {
    transformChannelData,
    type ChannelItem,
    type ChannelRequestData,
    type ModelOption,
} from "@/api/modules/channel/index";
import { useChannelStore, useEnterpriseStore } from "@/stores";
import { useVersion } from "@/hooks";
import { VERSION_MODULE } from "@/constants/enterprise";
import { MODEL_USE_TYPE } from "@/constants/platform/config";
import { clearModelCache } from "@/components/Model";
import { ModelGroup } from "./components/ModelGroup";
import { ModelSaveDialog } from "./components/ModelSaveDialog";
import {
    ModelSelectDialog,
    type ModelSelectDialogRef,
} from "./components/ModelSelectDialog";
import {
    ModelSettingDialog,
    type ModelSettingDialogRef,
} from "./components/ModelSettingDialog";

/** 渠道下按模型类型聚合的条目，带 source 便于多配置时区分来源 */
export type ModelTypeEntry = {
  modelType: string;
  modelTypeName: string;
  options: Array<Record<string, unknown> & { source?: ChannelItem }>;
  source?: ChannelItem;
};

/** 渠道组：单条时 items 长度为 1，多条时合并同类型配置 */
export interface ChannelGroup {
  channel_type: number;
  channelType: number;
  multiple: boolean;
  items: ChannelItem[];
  group: ModelTypeEntry[];
  modelValue: string[];
}

export function PlatformModel() {
  const modelSaveRef = useRef<{ open: (data?: any) => void }>(null);
  const modelSelectRef = useRef<ModelSelectDialogRef>(null);
  const modelSettingRef = useRef<ModelSettingDialogRef>(null);

  const channelStore = useChannelStore();
  const enterpriseStore = useEnterpriseStore();
  const { canUse: canUseKnowledgeBase } = useVersion({
    module: VERSION_MODULE.KNOWLEDGE_BASE,
  });

  const [channelLoading, setChannelLoading] = useState(false);
  const [channelList, setChannelList] = useState<ChannelGroup[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingData, setEditingData] = useState<any>(null);

  // Model list from store
  const modelList = useMemo(() => {
    const features = enterpriseStore.version?.features;
    const configList = channelStore.modelConfigListCopy();
    if (!canUseKnowledgeBase && features) {
      return configList
        .map((item) => ({
          ...item,
          categories: item.categories.filter(
            (c) => Number(c.model_type) === Number(MODEL_USE_TYPE.REASONING),
          ),
        }))
        .filter((item) =>
          item.categories.some(
            (c) => Number(c.model_type) === Number(MODEL_USE_TYPE.REASONING),
          ),
        );
    }
    return configList;
  }, [channelStore, enterpriseStore.version?.features]);

  /** 按 channel_type 分组 */
  const groupByChannelType = (list: ChannelItem[]) =>
    list.reduce(
      (acc, item) => {
        const k = item.channel_type;
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
      },
      {} as Record<number, ChannelItem[]>,
    );

  /** 单条配置：group 为该项的 group 并挂 source */
  const buildSingleGroup = (item: ChannelItem): ChannelGroup => ({
    channel_type: item.channel_type,
    channelType: item.channel_type,
    multiple: false,
    items: [item],
    group: item.group.map((g) => ({
      ...g,
      source: item,
      options: g.options.map((opt) => ({ ...opt, source: item })),
    })),
    modelValue: item.group.map((g) => String(g.modelType)),
  });

  /** 多条配置：合并同类型下所有项的 group（按 modelType 聚合，options 带 source） */
  const buildMergedGroup = (
    items: ChannelItem[],
    multipleTypes: number[],
  ): ChannelGroup => {
    const first = items[0];
    const group: ModelTypeEntry[] = [];
    for (const item of items) {
      for (const entry of item.group) {
        const same = group.find((x) => x.modelType === entry.modelType);
        const opts = entry.options.map((opt) => ({ ...opt, source: item }));
        if (same) same.options.push(...opts);
        else group.push({ ...entry, source: item, options: opts });
      }
    }
    return {
      channel_type: first.channel_type,
      channelType: first.channel_type,
      multiple: multipleTypes.includes(first.channel_type),
      items,
      group,
      modelValue: group.map((g) => g.modelType),
    };
  };

  const createChannelGroup = (
    list: ChannelItem[],
    multipleTypes: number[],
  ): ChannelGroup[] => {
    const byType = groupByChannelType(list);
    return Object.values(byType).flatMap((typeItems) => {
      const multiple = multipleTypes.includes(typeItems[0].channel_type);
      return multiple
        ? [buildMergedGroup(typeItems, multipleTypes)]
        : typeItems.map(buildSingleGroup);
    });
  };

  const loadModelList = useCallback(async () => {
    setChannelLoading(true);
    try {
      const list = await channelApi.listv2();

      const allowTypes = modelList.map((item) => item.channel_type);
      const multipleTypes = modelList
        .filter((item) => item.can_multiple)
        .map((item) => item.channel_type);
      const allowList = list
        .filter((item) => allowTypes.includes(item.type as any))
        .map((item) => transformChannelData(item));
      setChannelList(createChannelGroup(allowList, multipleTypes));
    } finally {
      setChannelLoading(false);
    }
  }, [modelList]);

  const handleModelSelect = () => {
    modelSelectRef.current?.open();
  };

  const handleModelAddGroup = (data: ModelOption) => {
    const model = modelList.find(
      (item) => item.channel_type === data.channel_type,
    );
    const defaultData = { base_url: "", key: "" };
    if (data.platform_id === "azure_openai") {
      defaultData.base_url = data.base_url || "";
      defaultData.key = data.key || "";
    }
    setEditingData({ ...model, ...defaultData });
    setSaveDialogOpen(true);
  };

  const handleModelAdd = (data: ModelOption) => {
    setEditingData(data);
    setSaveDialogOpen(true);
  };

  const handleModelEdit = (data: any) => {
    setEditingData(data);
    setSaveDialogOpen(true);
  };

  const handleModelDelete = async (data: any, model: any) => {
    Modal.confirm({
      title: t("action_delete"),
      content: t("module.platform_model_delete_confirm"),
      okText: t("action_confirm"),
      cancelText: t("action_cancel"),
      onOk: async () => {
        const isChildRemove = model && data.models.length > 1;
        if (isChildRemove) {
          const custom_config = { ...data.custom_config };
          delete custom_config[model.value];
          if (custom_config.deep_thinking?.includes(model.value)) {
            custom_config.deep_thinking = custom_config.deep_thinking.filter(
              (item: any) => item !== model.value,
            );
          }
          if (custom_config.vision?.includes(model.value)) {
            custom_config.vision = custom_config.vision.filter(
              (item: any) => item !== model.value,
            );
          }
          if (custom_config.text_generation?.includes(model.value)) {
            custom_config.text_generation =
              custom_config.text_generation.filter(
                (item: any) => item !== model.value,
              );
          }
          if (model.value in (custom_config.alias_map || {})) {
            delete custom_config.alias_map[model.value];
          }
          await channelApi.update(data.channel_id, {
            channel_id: data.channel_id,
            key: data.key,
            base_url: data.base_url,
            other: data.other,
            models: data.models
              .filter((item: any) => item !== model.value)
              .join(","),
            name: data.name,
            type: data.channel_type,
            config: JSON.stringify(data.config || {}),
            custom_config: JSON.stringify(custom_config),
          } as ChannelRequestData & { channel_id: number });
        } else {
          await channelApi.delete(data.channel_id);
        }

        message.success(t("action_delete_success"));
        clearModelCache();
        loadModelList();
      },
    });
  };

  const onModelEdit = ({
    data,
    parentData,
  }: {
    data: any;
    parentData: any;
  }) => {
    modelSettingRef.current?.open({
      data: { ...parentData, ...data, id: data.value },
    });
  };

  useEffect(() => {
    loadModelList();
  }, [loadModelList]);

  return (
    <div className="h-full flex flex-col bg-white py-6 px-2">
      <h2 className="w-full flex items-center justify-between font-semibold text-primary mb-6">
        <div className="flex-1 text-base">{t("module.platform_model")}</div>
        <Button type="primary" onClick={handleModelSelect}>
          {t("action_add")}
        </Button>
      </h2>
      <Spin spinning={channelLoading}>
        {channelList.length > 0 ? (
          <ul className="w-full flex flex-col gap-4 mb-8">
            {channelList.map((group) => (
              <ModelGroup
                key={group.multiple ? group.channel_type : group.items[0].channel_id}
                group={group}
                onAdd={handleModelAddGroup}
                onEdit={handleModelEdit}
                onDelete={handleModelDelete}
                onModelEdit={onModelEdit}
              />
            ))}
          </ul>
        ) : (
          <Empty
            description={t("no_data")}
            image={getRealPath("/images/empty.png")}
            styles={{ image: { height: 110 } }}
          ></Empty>
        )}
      </Spin>

      <ModelSaveDialog
        open={saveDialogOpen}
        modelList={modelList}
        data={editingData}
        onClose={() => setSaveDialogOpen(false)}
        onSuccess={loadModelList}
      />

      <ModelSelectDialog
        ref={modelSelectRef}
        list={channelList}
        modelList={modelList}
        onAdd={handleModelAdd}
      />

      <ModelSettingDialog ref={modelSettingRef} onSuccess={loadModelList} />
    </div>
  );
}

export default PlatformModel;
