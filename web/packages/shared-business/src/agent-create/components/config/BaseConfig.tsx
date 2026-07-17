import { Button, Input, message } from "antd";
import {
  HolderOutlined
} from "@ant-design/icons";
import { SvgIcon, MarkdownEditor } from "@km/shared-components-react";
import { useAgentCreateAdapter } from "../../adapters";
import { useAgentForm } from "../../hooks";
import { useEffect, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CollapsibleSection } from "../shared/CollapsibleSection";

const MAX_QUESTION_LENGTH = 10;

interface Question {
  id: number | string;
  content: string;
}

function SortableItem({
  item,
  onDel,
  onChange,
  t,
}: {
  item: Question;
  onDel: (id: number | string) => void;
  onChange: (id: number | string, content: string) => void;
  t: (key: string) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2"
    >
      <div {...attributes} {...listeners} className="cursor-move">
        <HolderOutlined style={{ width: 16, height: 32, color: "#a1a5af" }} />
      </div>
      <div className="flex-1 flex items-center justify-center border pr-2 border-[#DCDFE6] rounded bg-white">
        <Input
          value={item.content}
          onChange={(e) => {
            onChange(item.id, e.target.value);
          }}
          variant="borderless"
          placeholder={t("form.input_placeholder")}
          maxLength={400}
        />
        <SvgIcon
          name="delete"
          className="ml-2 cursor-pointer"
          style={{ color: "rgba(24, 43, 80, 0.4)" }}
          onClick={() => onDel(item.id)}
        />
      </div>
    </div>
  );
}

export function BaseConfig() {
  const form = useAgentForm();
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);

  // 使用 hook 获取状态
  const suggestedQuestions = form.formData.settings.suggested_questions;
  const openingStatement = form.formData.settings.opening_statement;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 初始化：如果没有数据，添加一个空问题
  useEffect(() => {
    if (!suggestedQuestions || suggestedQuestions.length === 0) {
      form.updateSuggestedQuestions([{ id: Date.now(), content: "" }]);
    }
  }, []);

  // 直接使用 store 数据，通过 useMemo 避免不必要的重新渲染
  const questions = useMemo(
    () => suggestedQuestions || [],
    [suggestedQuestions],
  );

  const handleAdd = () => {
    if (questions.length >= MAX_QUESTION_LENGTH) {
      message.error(t("max_add_tip", { max: MAX_QUESTION_LENGTH }));
      return;
    }
    form.updateSuggestedQuestions([
      ...questions,
      { id: Date.now(), content: "" },
    ]);
  };

  const handleDel = (id: number | string) => {
    form.updateSuggestedQuestions(questions.filter((item) => item.id !== id));
  };

  const handleChange = (id: number | string, content: string) => {
    form.updateSuggestedQuestions(
      questions.map((item) => (item.id === id ? { ...item, content } : item)),
    );
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      form.updateSuggestedQuestions(
        arrayMove(
          questions,
          questions.findIndex((item) => item.id === active.id),
          questions.findIndex((item) => item.id === over.id),
        ),
      );
    }
  };

  return (
    <CollapsibleSection title={t("app.opening_welcome")} defaultExpanded>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs text-[#373A3D]">{t("app.opening_statement")}</div>
        <Button type="link" className="px-0"></Button>
      </div>
      <MarkdownEditor
        value={openingStatement}
        onChange={form.updateOpeningStatement}
        type="simple"
        className="w-full mb-2"
        height="200px"
        config={adapter.markdownEditorConfig || { cdn: '', apiHost: '' }}
      />
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs text-[#373A3D]">{t("app.suggested_questions")}</div>
        <Button type="link" className="px-0 gap-0" onClick={handleAdd}>
          <SvgIcon name="plus" size={16} />
          {t("action.add")}({questions.length}/{MAX_QUESTION_LENGTH})
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={questions.map((q) => q.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="w-full flex flex-col gap-2">
            {questions.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                onDel={handleDel}
                onChange={handleChange}
                t={t}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </CollapsibleSection>
  );
}

export default BaseConfig;