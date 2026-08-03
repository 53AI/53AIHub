import { useState } from "react";
import { Header } from "@/components/Header";
import { t } from "@/locales";
import { Button, Modal, Input, Select } from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const CORE_ENTITIES = [
  {
    id: 1,
    name: "合同",
    tags: ["甲方", "乙方", "金额", "状态", "签署时间", "类型", "付款方式"],
  },
  {
    id: 2,
    name: "组织",
    tags: ["甲方", "乙方", "金额", "状态", "签署时间", "类型", "付款方式"],
  },
  {
    id: 3,
    name: "条款",
    tags: ["甲方", "乙方", "金额", "状态", "签署时间", "类型", "付款方式"],
  },
  {
    id: 4,
    name: "合作方",
    tags: ["甲方", "乙方", "金额", "状态", "签署时间", "类型", "付款方式"],
  },
];

const RELATIONSHIPS = [
  { id: 1, subject: "合同", relation: "签署", object: "条款" },
  { id: 2, subject: "项目方案", relation: "包含", object: "参与方" },
  { id: 3, subject: "产品文档", relation: "签署", object: "条款" },
  { id: 4, subject: "合同", relation: "包含", object: "签署时间" },
  { id: 5, subject: "组织", relation: "包含", object: "甲方" },
];

interface SortableAttrItemProps {
  id: string;
  onRemove: (id: string) => void;
}

function SortableAttrItem({ id, onRemove }: SortableAttrItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
    position: isDragging ? ("relative" as const) : ("static" as const),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex justify-between items-center px-4 py-2.5 hover:bg-[#F5F5F5] group transition-colors bg-white"
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-move flex items-center outline-none"
        >
          <HolderOutlined className="text-gray-300 hover:text-gray-500" />
        </div>
        <span className="text-gray-700 text-[14px]">{id}</span>
      </div>
      <DeleteOutlined
        className="text-gray-400 opacity-0 group-hover:opacity-100 cursor-pointer hover:text-red-500 transition-all"
        onClick={() => onRemove(id)}
      />
    </div>
  );
}

export function KnowledgeGraphPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [unaddedAttrs, setUnaddedAttrs] = useState(["年龄", "性别", "邮箱"]);
  const [addedAttrs, setAddedAttrs] = useState([
    "昵称",
    "姓名",
    "手机号码",
    "企业地址",
    "税号",
    "爱好",
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setAddedAttrs((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleAddAttr = (attr: string) => {
    setUnaddedAttrs((prev) => prev.filter((a) => a !== attr));
    setAddedAttrs((prev) => [...prev, attr]);
  };

  const handleRemoveAttr = (attr: string) => {
    setAddedAttrs((prev) => prev.filter((a) => a !== attr));
    setUnaddedAttrs((prev) => [...prev, attr]);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[78px] bg-white">
      <Header
        className="pt-8 pb-5"
        title={t("space.setting.menu.knowledgeGraph")}
      />

      <div className="flex-1 overflow-y-auto">
        {/* 核心实体 */}
        <div>
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-medium text-[#4F5052]">{t("space.knowledge_graph.core_entities")}</h2>
            <Button
              color="primary"
              variant="filled"
              icon={<PlusOutlined />}
              onClick={() => setIsModalOpen(true)}
            >
              {t("action.add")}
            </Button>
          </div>

          <div className="flex flex-col gap-2 mt-3">
            {CORE_ENTITIES.map((entity) => (
              <div
                key={entity.id}
                className="bg-white border border-gray-200 rounded-lg p-4 flex items-center hover:border-blue-300 transition-colors"
              >
                <span className="font-medium text-gray-800 w-24 text-base">
                  {entity.name}
                </span>
                <div className="flex flex-wrap gap-2 flex-1">
                  {entity.tags.map((tag) => (
                    <span
                      key={tag}
                      className="h-6 flex items-center px-2 bg-[#F5F5F5] text-[#4F5052] rounded text-xs border border-gray-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 实体关系 */}
        <div>
          <div className="flex justify-between items-center mt-10 mb-3">
            <h2 className="text-sm font-medium text-[#4F5052]">{t("space.knowledge_graph.entity_relations")}</h2>
            <div className="flex gap-3">
              <Button
                style={{ color: '#722ED1', backgroundColor: '#F3F0FF', border: 'none' }}
                className="flex items-center gap-1 shadow-none"
              >
                <span className="text-[16px] leading-none">✦</span> {t("space.knowledge_graph.ai_generate")}
              </Button>
              <Button
                type="primary"
                className="bg-[#EBF1FF] text-[#2F54EB] border-none shadow-none flex items-center"
                icon={<PlusOutlined />}
              >
                {t("action.add")}
              </Button>
            </div>
          </div>

          <div className="bg-[#FCFCFF] border border-gray-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">
            {/* Input Row */}
            <div className="flex gap-2">
              <Select placeholder={t("space.knowledge_graph.select_entity_placeholder")} className="flex-1" />
              <Input
                placeholder={t("space.knowledge_graph.relation_type_placeholder")}
                className="flex-1"
              />
              <Select placeholder={t("space.knowledge_graph.entity_type_placeholder")} className="flex-1" />
            </div>

            {/* Data Rows */}
            {RELATIONSHIPS.map((rel) => (
              <div key={rel.id} className="flex gap-2">
                <Select value={rel.subject} className="flex-1" />
                <Input value={rel.relation} className="flex-1" />
                <Select value={rel.object} className="flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 添加实体 Modal */}
      <Modal
        title={<div className="text-[16px] font-medium">{t("space.knowledge_graph.add_entity_title")}</div>}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        width={680}
        centered
        footer={[
          <Button
            key="cancel"
            onClick={() => setIsModalOpen(false)}
            className="px-6"
          >
            {t("action.cancel")}
          </Button>,
          <Button
            key="submit"
            type="primary"
            onClick={() => setIsModalOpen(false)}
            className="px-6 bg-[#2F54EB]"
          >
            {t("action.confirm")}
          </Button>,
        ]}
        closeIcon={
          <span className="text-gray-400 hover:text-gray-600 text-lg">×</span>
        }
      >
        <div className="flex border border-gray-200 rounded-lg h-[420px] overflow-hidden mt-4">
          {/* 左侧：未添加 */}
          <div className="flex-1 border-r border-gray-200 flex flex-col bg-white">
            <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFAFA] text-gray-800 font-medium text-[14px]">
              {t("space.knowledge_graph.unadded_label")} ({unaddedAttrs.length})
            </div>
            <div className="flex px-4 py-3 border-b border-gray-100 text-gray-400 text-[13px]">
              {t("space.knowledge_graph.attribute_name")}
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {unaddedAttrs.map((attr) => (
                <div
                  key={attr}
                  className="flex justify-between items-center px-4 py-2.5 hover:bg-[#F5F5F5] cursor-pointer group transition-colors"
                  onClick={() => handleAddAttr(attr)}
                >
                  <span className="text-gray-700 text-[14px]">{attr}</span>
                  <div className="w-6 h-6 rounded flex items-center justify-center border border-gray-300 opacity-0 group-hover:opacity-100 hover:border-blue-500 hover:text-blue-500 transition-all">
                    <PlusOutlined className="text-xs" />
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gray-200 flex justify-center">
              <span className="text-[#2F54EB] cursor-pointer hover:text-blue-700 text-[14px] flex items-center gap-1">
                + {t("space.knowledge_graph.add_short")}
              </span>
            </div>
          </div>

          {/* 右侧：已添加 */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFAFA] text-gray-800 font-medium text-[14px]">
              {t("space.knowledge_graph.added_label")} ({addedAttrs.length})
            </div>
            <div className="flex px-4 py-3 border-b border-gray-100 text-gray-400 text-[13px] justify-between">
              <span>{t("space.knowledge_graph.attribute_name")}</span>
              <span>{t("action.operation")}</span>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={addedAttrs}
                  strategy={verticalListSortingStrategy}
                >
                  {addedAttrs.map((attr) => (
                    <SortableAttrItem
                      key={attr}
                      id={attr}
                      onRemove={handleRemoveAttr}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default KnowledgeGraphPage;
