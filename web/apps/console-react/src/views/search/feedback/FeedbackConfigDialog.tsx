import { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Modal, Input, Button, message } from "antd";
import { t } from "@/locales";
import { feedbackApi } from "@/api/modules/feedback";
import { useEnterpriseStore } from "@/stores";
import { Sortable, SortableRef } from "@km/shared-components-react";
import { SvgIcon } from "@km/shared-components-react";

interface FeedbackType {
  label: string;
  id: string;
}

interface FeedbackConfig {
  satisfied: string[];
  unsatisfied: string[];
}

export interface FeedbackConfigDialogRef {
  open: () => Promise<void>;
  close: () => void;
}

export const FeedbackConfigDialog = forwardRef<
  FeedbackConfigDialogRef,
  { type?: 'message' | 'knowledge_map' | 'work_ai' | 'chat' | 'workflow' }
>((props, ref) => {
  const { type = 'message' } = props;
  const enterpriseStore = useEnterpriseStore();
  const [visible, setVisible] = useState(false);
  const [satisfiedTypeList, setSatisfiedTypeList] = useState<FeedbackType[]>(
    [],
  );
  const [unsatisfiedTypeList, setUnsatisfiedTypeList] = useState<
    FeedbackType[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const satisfiedSortableRef = useRef<SortableRef>(null);
  const unsatisfiedSortableRef = useRef<SortableRef>(null);

  const loadFeedbackConfig = async () => {
    const configData = await feedbackApi.getConfig({
      eid: enterpriseStore.info.eid,
      type,
    });
    const list: FeedbackConfig = JSON.parse(configData.value);
    if (list) {
      setSatisfiedTypeList(
        list.satisfied.map((item, index) => ({
          label: item,
          id: `satisfied${index}`,
        })),
      );
      setUnsatisfiedTypeList(
        list.unsatisfied.map((item, index) => ({
          label: item,
          id: `unsatisfied${index}`,
        })),
      );
    }
  };

  useImperativeHandle(ref, () => ({
    open: async () => {
      setSubmitting(false);
      await loadFeedbackConfig();
      setVisible(true);
    },
    close: () => {
      setVisible(false);
    },
  }));

  const onFeedbackTypeAdd = (fType: "satisfied" | "unsatisfied") => {
    const newId = `${fType}${fType === "satisfied" ? satisfiedTypeList.length : unsatisfiedTypeList.length}`;
    if (fType === "satisfied") {
      setSatisfiedTypeList([...satisfiedTypeList, { label: "", id: newId }]);
      setTimeout(() => {
        satisfiedSortableRef.current?.scrollToBottom?.();
      }, 0);
    } else {
      setUnsatisfiedTypeList([...unsatisfiedTypeList, { label: "", id: newId }]);
      setTimeout(() => {
        unsatisfiedSortableRef.current?.scrollToBottom?.();
      }, 0);
    }
    setFocusedId(newId);
  };

  const onFeedbackTypeRemove = (
    fType: "satisfied" | "unsatisfied",
    index: number,
  ) => {
    if (
      (fType === "satisfied" && satisfiedTypeList.length === 1) ||
      (fType === "unsatisfied" && unsatisfiedTypeList.length === 1)
    ) {
      return message.warning(t("group_min_one"));
    }

    Modal.confirm({
      title: t("action_delete"),
      content: t("search-feedback.delete_confirm"),
      okText: t("action_delete"),
      cancelText: t("action_cancel"),
      onOk: () => {
        if (fType === "satisfied") {
          const newList = [...satisfiedTypeList];
          newList.splice(index, 1);
          setSatisfiedTypeList(newList);
        } else {
          const newList = [...unsatisfiedTypeList];
          newList.splice(index, 1);
          setUnsatisfiedTypeList(newList);
        }
      },
    });
  };

  const onSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await feedbackApi.updateConfig({
        type,
        satisfied: satisfiedTypeList
          .map((item) => item.label.trim())
          .filter(Boolean),
        unsatisfied: unsatisfiedTypeList
          .map((item) => item.label.trim())
          .filter(Boolean),
      });
      message.success(t("action_save_success"));
      setVisible(false);
    } finally {
      setSubmitting(false);
    }
  };

  const renderSortableItem = (
    item: FeedbackType,
    fType: "satisfied" | "unsatisfied",
  ) => {
    return (
      <div className="flex items-center w-full">
        <div className="pr-3 sort-icon cursor-move flex items-center justify-center">
          <SvgIcon name="drag" width="16" height="32" color="#a1a5af" />
        </div>
        <div className="flex-1">
          <Input
            value={item.label}
            placeholder={t("form_input_placeholder")}
            className="w-full"
            maxLength={10}
            showCount
            autoFocus={item.id === focusedId}
            onBlur={() => {
              if (item.id === focusedId) setFocusedId(null);
            }}
            onChange={(e) => {
              if (fType === "satisfied") {
                const newList = [...satisfiedTypeList];
                const index = newList.findIndex((i) => i.id === item.id);
                if (index !== -1) {
                  newList[index].label = e.target.value;
                  setSatisfiedTypeList(newList);
                }
              } else {
                const newList = [...unsatisfiedTypeList];
                const index = newList.findIndex((i) => i.id === item.id);
                if (index !== -1) {
                  newList[index].label = e.target.value;
                  setUnsatisfiedTypeList(newList);
                }
              }
            }}
          />
        </div>
        <SvgIcon
          name="delete"
          className="ml-4 cursor-pointer"
          style={{ color: "rgba(24, 43, 80, 0.4)" }}
          onClick={() => {
            const list =
              fType === "satisfied" ? satisfiedTypeList : unsatisfiedTypeList;
            const index = list.findIndex((i) => i.id === item.id);
            if (index !== -1) onFeedbackTypeRemove(fType, index);
          }}
        />
      </div>
    );
  };

  return (
    <Modal
      title={t("search-feedback.config")}
      open={visible}
      onCancel={() => setVisible(false)}
      width={680}
      destroyOnHidden
      mask={{ closable: false }}
      footer={[
        <Button
          key="cancel"
          className="text-primary"
          onClick={() => setVisible(false)}
        >
          {t("action_cancel")}
        </Button>,
        <Button key="save" type="primary" loading={submitting} onClick={onSave}>
          {t("action_save")}
        </Button>,
      ]}
    >
      <div className="text-dark text-opacity-60 text-sm pb-4">
        {t("search-feedback.statisfied_type")}
      </div>
      <Sortable
        ref={satisfiedSortableRef}
        value={satisfiedTypeList}
        onChange={setSatisfiedTypeList}
        identity="id"
        className="w-full flex flex-col gap-4 max-h-[24vh] overflow-y-auto"
        renderItem={(item: FeedbackType) =>
          renderSortableItem(item, "satisfied")
        }
      />
      <Button
        type="link"
        className="mt-4 ml-5"
        onClick={() => onFeedbackTypeAdd("satisfied")}
      >
        +{t("action_add")}
      </Button>

      <div className="text-dark text-opacity-60 text-sm pb-4 mt-7">
        {t("search-feedback.unstatisfied_type")}
      </div>
      <Sortable
        ref={unsatisfiedSortableRef}
        value={unsatisfiedTypeList}
        onChange={setUnsatisfiedTypeList}
        identity="id"
        className="w-full flex flex-col gap-4 max-h-[24vh] overflow-y-auto"
        renderItem={(item: FeedbackType) =>
          renderSortableItem(item, "unsatisfied")
        }
      />
      <Button
        type="link"
        className="mt-4 ml-5"
        onClick={() => onFeedbackTypeAdd("unsatisfied")}
      >
        +{t("action_add")}
      </Button>
    </Modal>
  );
});

FeedbackConfigDialog.displayName = "FeedbackConfigDialog";

export default FeedbackConfigDialog;
