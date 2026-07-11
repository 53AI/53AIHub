import { Button, Input, message } from "antd";
import {
    PlusOutlined,
    HolderOutlined,
} from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useEffect, useMemo } from "react";
import { t } from "@/locales";
import { useAgentForm } from "../../hooks";
import { MarkdownEditor } from "@/components/Markdown/editor";
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

const MAX_QUESTION_LENGTH = 10;

interface Question {
  id: number;
  content: string;
}

function SortableItem({
  item,
  onDel,
  onChange,
}: {
  item: Question;
  onDel: (id: number) => void;
  onChange: (id: number, content: string) => void;
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
      className="flex items-center border px-2 border-[#DCDFE6] rounded-sm bg-white"
    >
      <div {...attributes} {...listeners} className="cursor-move">
        <HolderOutlined style={{ width: 16, height: 32, color: "#a1a5af" }} />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Input
          value={item.content}
          onChange={(e) => {
            onChange(item.id, e.target.value);
          }}
          variant="borderless"
          placeholder={t("form_input_placeholder")}
          maxLength={400}
          showCount
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

  const handleDel = (id: number) => {
    form.updateSuggestedQuestions(questions.filter((item) => item.id !== id));
  };

  const handleChange = (id: number, content: string) => {
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
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm text-secondary">{t("opening_statement")}</div>
      </div>
      <MarkdownEditor
        value={openingStatement}
        onChange={form.updateOpeningStatement}
        type="simple"
        className="w-full mb-4"
        height="200px"
      />
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm text-secondary">{t("suggested_questions")}</div>
        <Button type="link" className="px-0" onClick={handleAdd}>
          <PlusOutlined className="size-3" />
          {t("action_add")}
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
          <div className="w-full flex flex-col gap-4 mb-4">
            {questions.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                onDel={handleDel}
                onChange={handleChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  );
}

export default BaseConfig;
