import { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Button, InputNumber, Modal, Switch, message, Spin } from "antd";
import { PlusOutlined, LoadingOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { skillApi } from "@/api/modules/skill";
import { validateUsageGuide } from "../../../utils/usageValidation";
import { generateItemId, buildUsageGuide } from "../../../utils/buildUsageGuide";
import BestPracticeEditor from "./BestPracticeEditor";
import ContentFormModal from "./ContentFormModal";
import { usageOptions } from "./constants";
import type { UsageSwitches, UsageItems, UsageGuideRef, UsageItem } from "./types";
import { t } from "@/locales";

const DEFAULT_QUALITY_SCORES = [
  { key: "completeness", label: t("skills.quality.completeness"), value: 0.0 },
  { key: "practicality", label: t("skills.quality.practicality"), value: 0.0 },
  { key: "security", label: t("skills.quality.security"), value: 0.0 },
  { key: "code_quality", label: t("skills.quality.code_quality"), value: 0.0 },
  { key: "documentation", label: t("skills.quality.documentation"), value: 0.0 },
];

const UsageGuide = forwardRef<UsageGuideRef, { skillId: string }>(
  ({ skillId }, ref) => {
    const [usageSwitches, setUsageSwitches] = useState<UsageSwitches>({
      quality_scores: true,
      capabilities: false,
      usage_example: false,
      best_practice: false,
      faq: false,
    });

    const [usageItems, setUsageItems] = useState<UsageItems>({
      quality_scores: DEFAULT_QUALITY_SCORES,
      capabilities: [],
      usage_example: [],
      bestPracticesPositive: [],
      bestPracticesNegative: [],
      faq: [],
    });

    const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
    const [isAddContentModalOpen, setIsAddContentModalOpen] = useState(false);
    const [currentAddingSection, setCurrentAddingSection] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<UsageItem | null>(null);
    const [aiGeneratingSections, setAiGeneratingSections] = useState<Set<string>>(new Set());

    const hasEnabledUsageSection = Object.values(usageSwitches).some((v) => v);
    const isFaqSection = currentAddingSection === "faq";

    // 保存初始数据快照，用于检测是否修改
    const originalSwitchesRef = useRef<string>("");
    const originalItemsRef = useRef<string>("");

    useImperativeHandle(ref, () => ({
      getUsageData: () => ({ usageSwitches, usageItems }),
      setUsageData: (newSwitches, newItems) => {
        // 保存初始状态的 JSON 快照
        originalSwitchesRef.current = JSON.stringify(newSwitches);
        originalItemsRef.current = JSON.stringify(newItems);
        setUsageSwitches(newSwitches);
        setUsageItems(newItems);
      },
      validate: () => validateUsageGuide(usageSwitches, usageItems),
      buildUsageGuide: () => buildUsageGuide(usageSwitches, usageItems),
      isUnSaved: () => {
        if (!originalSwitchesRef.current && !originalItemsRef.current) return false;
        return (
          JSON.stringify(usageSwitches) !== originalSwitchesRef.current ||
          JSON.stringify(usageItems) !== originalItemsRef.current
        );
      },
    }));

    const isAiGenerating = (sectionKey: string) => aiGeneratingSections.has(sectionKey);

    const setAiGenerating = (sectionKey: string, generating: boolean) => {
      setAiGeneratingSections((prev) => {
        const newSet = new Set(prev);
        if (generating) {
          newSet.add(sectionKey);
        } else {
          newSet.delete(sectionKey);
        }
        return newSet;
      });
    };

    const toggleUsageSwitch = (key: keyof UsageSwitches) => {
      setUsageSwitches((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleAIGenerate = async (generationType: string) => {
      if (!skillId) {
        message.warning(t("skills.usage.skill_id_empty"));
        return;
      }

      setAiGenerating(generationType, true);

      try {
        const response = await skillApi.aiGenerate(skillId, {
          generation_type: generationType,
        });

        const content = response.data?.content;
        if (!content) {
          message.warning(t("skills.usage.ai_content_empty"));
          return;
        }

        switch (generationType) {
          case "capabilities":
            if (content.title) {
              setUsageItems((prev) => ({
                ...prev,
                capabilities: [
                  ...prev.capabilities,
                  { id: generateItemId(), title: content.title, description: content.description || "" },
                ],
              }));
            }
            break;
          case "usage_example":
            if (content.question) {
              setUsageItems((prev) => ({
                ...prev,
                usage_example: [
                  ...prev.usage_example,
                  { id: generateItemId(), title: content.question, description: content.answer || "" },
                ],
              }));
            }
            break;
          case "best_practice":
            if (content.positive_case) {
              setUsageItems((prev) => ({
                ...prev,
                bestPracticesPositive: [
                  ...prev.bestPracticesPositive,
                  { id: generateItemId(), title: content.positive_case, description: "" },
                ],
              }));
            }
            if (content.negative_case) {
              setUsageItems((prev) => ({
                ...prev,
                bestPracticesNegative: [
                  ...prev.bestPracticesNegative,
                  { id: generateItemId(), title: content.negative_case, description: "" },
                ],
              }));
            }
            break;
          case "faq":
            if (content.question) {
              setUsageItems((prev) => ({
                ...prev,
                faq: [
                  ...prev.faq,
                  { id: generateItemId(), title: content.question, description: content.answer || "" },
                ],
              }));
            }
            break;
        }

        message.success(t("skills.usage.ai_generate_success"));
      } catch (error) {
        console.error(t("skills.usage.ai_generate_failed"), error);
        message.error(t("skills.usage.ai_generate_failed"));
      } finally {
        setAiGenerating(generationType, false);
      }
    };

    const handleAddContent = (sectionKey: string) => {
      setCurrentAddingSection(sectionKey);
      setEditingItem(null);
      setIsAddContentModalOpen(true);
    };

    const handleEditContent = (sectionKey: string, item: UsageItem) => {
      setCurrentAddingSection(sectionKey);
      setEditingItem(item);
      setIsAddContentModalOpen(true);
    };

    const handleDeleteContent = (sectionKey: string, itemId: string) => {
      const keyMap: Record<string, keyof UsageItems> = {
        capabilities: "capabilities",
        usage_example: "usage_example",
        bestPracticesPositive: "bestPracticesPositive",
        bestPracticesNegative: "bestPracticesNegative",
        faq: "faq",
      };
      const key = keyMap[sectionKey] ?? "faq";
      setUsageItems((prev) => ({
        ...prev,
        [key]: prev[key].filter((item) => item.id !== itemId),
      }));
    };

    const handleAddBestPractice = (type: "positive" | "negative") => {
      const key = type === "positive" ? "bestPracticesPositive" : "bestPracticesNegative";
      setUsageItems((prev) => ({
        ...prev,
        [key]: [...prev[key], { id: generateItemId(), title: "", description: "" }],
      }));
    };

    const handleBestPracticeChange = (
      type: "positive" | "negative",
      itemId: string,
      title: string
    ) => {
      const key = type === "positive" ? "bestPracticesPositive" : "bestPracticesNegative";
      setUsageItems((prev) => ({
        ...prev,
        [key]: prev[key].map((i) => (i.id === itemId ? { ...i, title } : i)),
      }));
    };

    const handleQualityScoreChange = (key: string, value: number) => {
      setUsageItems((prev) => ({
        ...prev,
        quality_scores: prev.quality_scores.map((s) =>
          s.key === key ? { ...s, value } : s
        ),
      }));
    };

    const handleContentFormConfirm = (title: string, description: string) => {
      if (!currentAddingSection) return;

      const sectionKey = currentAddingSection as keyof UsageItems;

      if (editingItem) {
        setUsageItems((prev) => ({
          ...prev,
          [sectionKey]: prev[sectionKey].map((item) =>
            item.id === editingItem.id ? { ...item, title, description } : item
          ),
        }));
      } else {
        setUsageItems((prev) => ({
          ...prev,
          [sectionKey]: [
            ...prev[sectionKey],
            { id: generateItemId(), title, description },
          ],
        }));
      }
      setIsAddContentModalOpen(false);
    };

    const renderSectionContent = (option: typeof usageOptions[number]) => {
      if (option.key === "quality_scores") {
        return (
          <div className="space-y-2 mt-4">
            {usageItems.quality_scores.map((scoreItem) => (
              <div
                key={scoreItem.key}
                className="flex items-center border border-[#d9d9d9] rounded hover:border-[#4096ff] focus-within:border-[#4096ff]"
              >
                <span className="text-sm text-gray-600 w-[90px] text-center bg-[#f5f5f5] py-1 border-r border-[#d9d9d9]">
                  {scoreItem.label}
                </span>
                <InputNumber
                  value={scoreItem.value}
                  onChange={(val) => handleQualityScoreChange(scoreItem.key, val ?? 0)}
                  min={0}
                  max={5}
                  step={0.1}
                  controls={false}
                  variant="borderless"
                  className="flex-1 bg-white"
                  disabled={isAiGenerating(option.key)}
                />
              </div>
            ))}
          </div>
        );
      }

      if (option.key === "best_practice") {
        return (
          <BestPracticeEditor
            positive={usageItems.bestPracticesPositive}
            negative={usageItems.bestPracticesNegative}
            disabled={isAiGenerating(option.key)}
            onAdd={handleAddBestPractice}
            onChange={handleBestPracticeChange}
            onDelete={(type, id) => handleDeleteContent(`bestPractices${type === "positive" ? "Positive" : "Negative"}`, id)}
          />
        );
      }

      const items = option.key === "usage_example" ? usageItems.usage_example : usageItems[option.key];

      return (
        <div className="flex flex-wrap gap-2 items-center mt-4">
          {items?.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 h-[38px] px-3 bg-white rounded-lg text-sm text-gray-700 ${
                isAiGenerating(option.key) ? "opacity-50" : ""
              }`}
            >
              <span>{item.title}</span>
              <div className="flex items-center gap-1 text-base">
                <SvgIcon
                  name="edit"
                  className={`cursor-pointer ${
                    isAiGenerating(option.key)
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-400 hover:text-blue-500"
                  }`}
                  onClick={() => !isAiGenerating(option.key) && handleEditContent(option.key, item)}
                />
                <SvgIcon
                  name="delete"
                  className={`cursor-pointer ${
                    isAiGenerating(option.key)
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-400 hover:text-red-500"
                  }`}
                  onClick={() => !isAiGenerating(option.key) && handleDeleteContent(option.key, item.id)}
                />
              </div>
            </div>
          ))}
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={() => handleAddContent(option.key)}
            disabled={isAiGenerating(option.key)}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium h-8 px-2"
          >
            {t("action_add")}
          </Button>
        </div>
      );
    };

    return (
      <>
        <div className="h-11 flex items-center justify-between">
          <h3 className="text-sm text-[#373A3D] font-medium">使用说明</h3>
          <Button
            color="default"
            variant="link"
            className="px-0"
            onClick={() => setIsUsageModalOpen(true)}
          >
            <PlusOutlined />
          </Button>
        </div>
        {hasEnabledUsageSection && (
          <div className="flex flex-col gap-2">
            {usageOptions.map((option) =>
              usageSwitches[option.key] ? (
                <Spin
                  key={option.key}
                  spinning={isAiGenerating(option.key)}
                  indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />}
                >
                  <div className="bg-[#fff] border rounded-lg p-4 relative group">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`size-7 rounded-md flex items-center justify-center cursor-pointer ${option.iconBg}`}
                        >
                          <SvgIcon name={option.svgIcon} size={16} color={option.svgColor} />
                        </div>
                        <span className="text-sm font-semibold text-gray-900 cursor-pointer">
                          {option.title}
                        </span>
                        {option.key !== "quality_scores" && (
                          <span
                            className="flex items-center px-2 py-0.5 bg-[#F3F0FF] hover:opacity-60 text-[#8063E3] rounded text-sm cursor-pointer"
                            onClick={() => !isAiGenerating(option.key) && handleAIGenerate(option.key)}
                          >
                            {isAiGenerating(option.key) ? (
                              <LoadingOutlined style={{ fontSize: 12 }} className="mr-1" />
                            ) : (
                              <SvgIcon name="star-four-2" size={12} className="mr-1" />
                            )}
                            {isAiGenerating(option.key) ? t("skills.usage.generating") : t("graph_template.ai_generate")}
                          </span>
                        )}
                      </div>
                      <SvgIcon
                        name="delete"
                        className={`invisible group-hover:visible cursor-pointer ${
                          isAiGenerating(option.key)
                            ? "text-gray-300 cursor-not-allowed"
                            : "text-gray-400 hover:text-red-500"
                        }`}
                        onClick={() => !isAiGenerating(option.key) && toggleUsageSwitch(option.key)}
                      />
                    </div>
                    {renderSectionContent(option)}
                  </div>
                </Spin>
              ) : null
            )}
          </div>
        )}

        <Modal
          open={isUsageModalOpen}
          title={t("agent.usage_guide_title")}
          onCancel={() => setIsUsageModalOpen(false)}
          footer={null}
          width={560}
        >
          <div className="space-y-4">
            {usageOptions.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-4 p-4 rounded-xl bg-[#F7F8FA] hover:shadow group"
              >
                <div
                  className={`size-12 rounded-xl flex items-center justify-center shrink-0 ${item.iconBg}`}
                >
                  <SvgIcon name={item.svgIcon} size={20} color={item.svgColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-400 truncate">
                    {item.description}
                  </p>
                </div>
                <Switch
                  checked={usageSwitches[item.key]}
                  onChange={() => toggleUsageSwitch(item.key)}
                />
              </div>
            ))}
          </div>
        </Modal>

        <ContentFormModal
          open={isAddContentModalOpen}
          editingItem={editingItem}
          isFaq={isFaqSection}
          onConfirm={handleContentFormConfirm}
          onCancel={() => setIsAddContentModalOpen(false)}
        />
      </>
    );
  }
);

UsageGuide.displayName = "UsageGuide";

export default UsageGuide;
export { usageOptions } from "./constants";
export type { UsageSwitches, UsageItems, UsageGuideRef } from "./types";
