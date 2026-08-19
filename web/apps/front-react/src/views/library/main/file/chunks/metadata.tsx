import { useState, useEffect, useMemo, useCallback } from "react";
import { Button, Input, Select, message, Modal } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { SvgIcon } from "@km/shared-components-react";
import entitiesApi, { EntityType, RawEntity } from "@/api/modules/entities";
import filesApi from "@/api/modules/files";
import { DEFAULT_PIPELINE_STEP } from '@km/shared-business/knowledge-pipeline';
import "./metadata.css";
import { t } from "@/locales";

const { TextArea } = Input;

/**
 * Metadata view component
 * Vue migration from metadata.vue
 */
export function MetadataView() {
  const libraryStore = useLibraryStore();

  // Document summary state
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editingSummaryText, setEditingSummaryText] = useState("");

  // Entity state
  const [entityList, setEntityList] = useState<RawEntity[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);

  // Category editing state
  const [editingCategoryId, setEditingCategoryId] = useState<EntityType | null>(
    null,
  );
  const [editingCategoryName, setEditingCategoryName] = useState("");

  // Add category state
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newEntity, setNewEntity] = useState({
    name: "",
    type: "" as EntityType,
    status: "active" as const,
  });

  // Tag adding state
  const [addingTagCategoryId, setAddingTagCategoryId] =
    useState<EntityType | null>(null);
  const [newTagName, setNewTagName] = useState("");

  const currentFile = libraryStore.currentFile();

  // Group entities by type
  const groupEntityList = useMemo(() => {
    return entityList.reduce(
      (acc, item) => {
        if (!acc[item.type]) {
          acc[item.type] = [];
        }
        acc[item.type].push(item);
        return acc;
      },
      {} as Record<EntityType, RawEntity[]>,
    );
  }, [entityList]);

  // Fetch entity types
  const getEntityTypes = useCallback(async () => {
    try {
      const res = await entitiesApi.getTypes();
      setEntityTypes(Object.keys(res) as EntityType[]);
    } catch (error) {
      console.error("Failed to fetch entity types:", error);
    }
  }, []);

  // Fetch entity list
  const getEntityList = useCallback(async () => {
    if (!currentFile?.id) return;
    try {
      const res = await entitiesApi.listByFileId(currentFile.id);
      setEntityList(res);
    } catch (error) {
      console.error("Failed to fetch entity list:", error);
    }
  }, [currentFile?.id]);

  // Summary handlers
  const startEditSummary = () => {
    setEditingSummaryText(currentFile?.summary || "");
    setIsEditingSummary(true);
  };

  const cancelEditSummary = () => {
    setIsEditingSummary(false);
    setEditingSummaryText("");
  };

  const handleSaveSummary = async () => {
    if (!currentFile?.id) return;
    try {
      await filesApi.generatedContent(currentFile.id, {
        summary: editingSummaryText,
      });
      message.success(t("status.save_success"));
      setIsEditingSummary(false);
      setEditingSummaryText("");
      libraryStore.loadFile(currentFile.id, true);
    } catch (error) {
      console.error("Failed to save summary:", error);
      message.error(t("status.save_fail"));
    }
  };

  // Category name save
  const saveCategoryName = (type: EntityType) => {
    if (!editingCategoryName.trim()) {
      setEditingCategoryId(null);
      return;
    }
    // Entity type name cannot be edited, other logic can be added here
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  // Delete category (all entities of this type)
  const handleDelCategory = (type: EntityType) => {
    Modal.confirm({
      title: "确认删除",
      content: `是否删除${type}分类及该分类下的所有标签？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          const entities = entityList.filter((e) => e.type === type);
          await Promise.all(entities.map((e) => entitiesApi.delete(e.id)));
          await getEntityList();
          message.success(t("status.delete_success"));
        } catch (error) {
          console.error("Failed to delete category:", error);
        }
      },
    });
  };

  // Add category handlers
  const handleStartAddCategory = () => {
    setIsAddingCategory(true);
    setNewEntity({ name: "", type: "" as EntityType, status: "active" });
  };

  const handleConfirmAddCategory = async () => {
    if (!newEntity.name.trim()) {
      setIsAddingCategory(false);
      return;
    }
    try {
      await entitiesApi.createByFileId(currentFile?.id || "", {
        type: newEntity.type,
        name: newEntity.name,
      });
      await getEntityList();
      setIsAddingCategory(false);
      setNewEntity({ name: "", type: "" as EntityType, status: "active" });
      message.success(t("status.save_success"));
    } catch (error) {
      console.error("Failed to add category:", error);
      message.error(t("status.save_fail"));
    }
  };

  const handleCancelAddCategory = () => {
    setIsAddingCategory(false);
    setNewEntity({ name: "", type: "" as EntityType, status: "active" });
  };

  // Add tag handlers
  const startAddTag = (type: EntityType) => {
    setAddingTagCategoryId(type);
    setNewTagName("");
  };

  const handleConfirmAddTag = async (type: EntityType) => {
    if (!newTagName.trim()) {
      setAddingTagCategoryId(null);
      return;
    }
    const entities = entityList.filter((c) => c.type === type);
    if (entities.some((e) => e.name === newTagName.trim())) {
      message.warning("标签已存在");
      return;
    }
    try {
      await entitiesApi.createByFileId(currentFile?.id || "", {
        type,
        name: newTagName.trim(),
      });
      await getEntityList();
      setAddingTagCategoryId(null);
      setNewTagName("");
    } catch (error) {
      console.error("Failed to add tag:", error);
    }
  };

  // Remove tag
  const handleRemoveTag = async (entityId: string) => {
    try {
      await entitiesApi.delete(entityId);
      await getEntityList();
      message.success(t("status.delete_success"));
    } catch (error) {
      console.error("Failed to remove tag:", error);
    }
  };

  useEffect(() => {
    const stepKeys = DEFAULT_PIPELINE_STEP.map((s) => s.step_key);
    const status = currentFile?.cleaning_info?.status;
    const currentStepKey = currentFile?.cleaning_info?.step_key;
    const currentIndex = stepKeys.findIndex((key) => key === currentStepKey);
    const summaryIndex = stepKeys.findIndex((key) => key === "summary_generation");
    if (['completed', 'failed', 'success'].includes(status || '') || currentIndex >= summaryIndex) {
      getEntityTypes();
      getEntityList();
    }
  }, [getEntityTypes, getEntityList, currentFile?.cleaning_info?.status, currentFile?.cleaning_info?.step_key]);

  return (
    <div className="p-10 h-full overflow-y-auto bg-[#F8FAFC] animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-10 pb-10">
        {/* Basic Info Section */}
        <section>
          <div className="flex items-center gap-2 mb-6 border-l-4 border-blue-600 pl-3 h-4 rounded-sm">
            <h3 className="font-semibold text-[#1D1E1F] text-base">基础信息</h3>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {/* Document Format */}
            <div className="bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-blue-600 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="document" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  文档格式
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate">
                  {(currentFile?.file_ext || "").toUpperCase()}
                </p>
              </div>
            </div>

            {/* Document Size */}
            <div className="bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-emerald-500 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="data" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  文档原始大小
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate">
                  {currentFile?.file_size}
                </p>
              </div>
            </div>

            {/* Upload Time */}
            <div className="bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-purple-500 rounded-lg bg-purple-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="clock" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  上传时间
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate">
                  {currentFile?.created_at}
                </p>
              </div>
            </div>

            {/* Last Update */}
            <div className="bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-blue-500 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="refresh" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  最近更新
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate">
                  {currentFile?.updated_at}
                </p>
              </div>
            </div>

            {/* Document Source */}
            <div className="col-span-2 bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-orange-400 rounded-lg bg-orange-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="folder-open" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  文档来源
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate">
                  {currentFile?.upload_source === "local"
                    ? "本地上传"
                    : "云存储"}
                </p>
              </div>
            </div>

            {/* File ID */}
            <div className="col-span-2 bg-white rounded-xl px-5 py-4 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default group">
              <div className="w-7 h-7 text-red-400 rounded-lg bg-red-50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <SvgIcon name="id-card" size={16} />
              </div>
              <div className="overflow-hidden">
                <p className="text-[#999999] text-sm mb-1 font-medium">
                  文件ID
                </p>
                <p className="text-base font-medium text-[#1D1E1F] truncate font-mono">
                  {currentFile?.id}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Document Summary Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 border-l-4 border-blue-600 pl-3 h-4 rounded-sm">
              <h3 className="font-semibold text-[#1D1E1F] text-base">
                文档摘要
              </h3>
              <span className="bg-[#F3F0FF] text-[#8063E3] px-2 h-[26px] rounded text-sm flex items-center gap-1">
                <SvgIcon name="magic-stick" size={12} /> AI生成
              </span>
            </div>
            {isEditingSummary ? (
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  className="bg-transparent !px-3"
                  onClick={cancelEditSummary}
                >
                  取消
                </Button>
                <Button
                  type="primary"
                  ghost
                  size="small"
                  className="bg-transparent !px-3"
                  onClick={handleSaveSummary}
                >
                  保存
                </Button>
              </div>
            ) : (
              <Button
                type="primary"
                ghost
                size="small"
                className="bg-transparent !px-2"
                onClick={startEditSummary}
              >
                <SvgIcon name="edit" /> 编辑
              </Button>
            )}
          </div>

          <div
            className={
              isEditingSummary
                ? "border border-[#2563EB] rounded-lg"
                : "pl-[2px] rounded-xl bg-[#2563EB]"
            }
          >
            <div className="bg-white rounded-lg p-5 shadow-sm relative group">
              {isEditingSummary ? (
                <TextArea
                  value={editingSummaryText}
                  onChange={(e) => setEditingSummaryText(e.target.value)}
                  autoSize={{ minRows: 4 }}
                  style={{ border: "none", boxShadow: "none" }}
                  className="!p-0 summary-textarea"
                  placeholder="请输入文档摘要"
                  variant="borderless"
                />
              ) : currentFile?.summary ? (
                <p
                  className="text-sm text-[#1D1E1F] text-justify"
                  dangerouslySetInnerHTML={{ __html: currentFile.summary }}
                />
              ) : (
                <p className="text-sm text-[#999999] text-justify">--</p>
              )}
            </div>
          </div>
        </section>

        {/* Tags Section */}
        <section>
          <div className="flex items-center gap-2 mb-6 border-l-4 border-blue-600 pl-3 h-4 rounded-sm">
            <h3 className="font-semibold text-[#1D1E1F] text-base">文档标签</h3>
          </div>
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {/* Tag Category Cards */}
              {Object.entries(groupEntityList).map(([type, entities]) => (
                <div
                  key={type}
                  className="group bg-white rounded-xl px-5 py-4 shadow-sm hover:shadow-md transition-all duration-300 h-full min-h-[150px] flex flex-col hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between pb-2 mb-4 border-b border-[#E6E8EB]">
                    {editingCategoryId === type ? (
                      <Input
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        size="small"
                        className="!w-24"
                        onPressEnter={() =>
                          saveCategoryName(type as EntityType)
                        }
                        onBlur={() => saveCategoryName(type as EntityType)}
                      />
                    ) : (
                      <span className="text-[#999999] text-sm">{type}</span>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="删除"
                          onClick={() => handleDelCategory(type as EntityType)}
                        >
                          <SvgIcon name="delete" size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 content-start flex-1">
                    {/* Tags */}
                    {entities.map((entity) => (
                      <span
                        key={entity.id}
                        className="bg-[#EFF6FF] text-sm text-[#2563EB] px-2 py-1 rounded hover:bg-blue-100 transition-colors cursor-default group/tag relative break-words min-w-0 max-w-full"
                      >
                        {entity.name}
                        <div className="absolute -right-1 -top-1 border rounded-full opacity-0 group-hover/tag:opacity-100 shadow-sm cursor-pointer hover:text-red-500 transition-opacity">
                          <SvgIcon
                            name="close"
                            className="bg-white"
                            size={12}
                            onClick={() => handleRemoveTag(entity.id)}
                          />
                        </div>
                      </span>
                    ))}
                    {/* Add tag input */}
                    {addingTagCategoryId === type ? (
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        size="small"
                        className="!w-44"
                        placeholder="输入内容，按 Enter 完成添加"
                        maxLength={20}
                        onPressEnter={() =>
                          handleConfirmAddTag(type as EntityType)
                        }
                        onBlur={() => handleConfirmAddTag(type as EntityType)}
                      />
                    ) : (
                      <button
                        className="w-[26px] h-[26px] bg-[#f8fafc] border border-dashed border-slate-300 text-slate-400 rounded-[6px] flex items-center justify-center hover:border-blue-400 hover:text-blue-500 hover:bg-white transition-all"
                        title="添加标签"
                        onClick={() => startAddTag(type as EntityType)}
                      >
                        <SvgIcon name="plus" size={10} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Add Category Button */}
              {!isAddingCategory ? (
                <button
                  className="bg-white border border-dashed border-[#E6E8EB] rounded-xl flex items-center justify-center text-[#4F5052] hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/30 transition-all gap-1 group cursor-pointer shadow-sm hover:shadow-md min-h-[150px]"
                  onClick={handleStartAddCategory}
                >
                  <SvgIcon name="plus" />
                  <span className="text-sm font-medium">添加</span>
                </button>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-[#E6E8EB] p-5">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-[#4F5052]">
                        分类名称
                      </label>
                      <Select
                        value={newEntity.type || undefined}
                        onChange={(val) =>
                          setNewEntity((prev) => ({
                            ...prev,
                            type: val as EntityType,
                          }))
                        }
                        placeholder="请选择分类名称"
                        className="w-full"
                      >
                        {entityTypes.map((t) => (
                          <Select.Option key={t} value={t}>
                            {t}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-[#4F5052]">
                        标签名称
                      </label>
                      <Input
                        value={newEntity.name}
                        onChange={(e) =>
                          setNewEntity((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="请输入标签名称"
                        maxLength={20}
                        allowClear
                      />
                    </div>
                    <div className="flex items-center justify-end pt-2">
                      <Button onClick={handleCancelAddCategory}>取消</Button>
                      <Button
                        type="primary"
                        className="ml-2"
                        onClick={handleConfirmAddCategory}
                      >
                        添加
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MetadataView;
