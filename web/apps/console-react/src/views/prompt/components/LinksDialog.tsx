import React, { useContext, useMemo } from "react";
import { Modal, Button, message, Table } from "antd";
import {
    useRef,
    useState,
    forwardRef,
    useImperativeHandle,
} from "react";
import { t } from "@/locales";
import { settingApi, DefaultLinkItem } from "@/api/modules/setting";
import StoreDialog from "@/views/toolbox-refactored/components/StoreDialog";
import { HolderOutlined } from "@ant-design/icons";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TableColumnsType } from "antd";

const MAX_LINKS_LEN = 8;

export interface LinksDialogRef {
  open: () => void;
  close: () => void;
}

interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: SyntheticListenerMap;
}

const RowContext = React.createContext<RowContextProps>({});

const DragHandle: React.FC = () => {
  const { setActivatorNodeRef, listeners } = useContext(RowContext);
  return (
    <Button
      type="text"
      size="small"
      icon={<HolderOutlined />}
      style={{ cursor: "move", color: "#a1a5af" }}
      ref={setActivatorNodeRef}
      {...listeners}
    />
  );
};

interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  "data-row-key": string;
}

const Row: React.FC<RowProps> = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props["data-row-key"] });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 9999, background: "#ECF5FF" } : {}),
  };

  const contextValue = useMemo<RowContextProps>(
    () => ({ setActivatorNodeRef, listeners }),
    [setActivatorNodeRef, listeners]
  );

  return (
    <RowContext.Provider value={contextValue}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes} />
    </RowContext.Provider>
  );
};

const LinksDialog = forwardRef<LinksDialogRef>((_, ref) => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [defaultLinks, setDefaultLinks] = useState<DefaultLinkItem[]>([]);
  const [originDefaultLinks, setOriginDefaultLinks] = useState<
    DefaultLinkItem[]
  >([]);
  const [deleteDefaultLinks, setDeleteDefaultLinks] = useState<
    DefaultLinkItem[]
  >([]);
  const storeDialogRef = useRef<any>(null);

  const loadDefaultLinks = async () => {
    setLoading(true);
    try {
      const { data } = (await settingApi.default_links.list()) as any;
      setOriginDefaultLinks(data || []);
      setDefaultLinks(data || []);
    } catch (error) {
      console.error("Load default links error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDefaultLink = (item: { data: DefaultLinkItem }) => {
    setDefaultLinks((prev) => [...prev, item.data]);
  };

  const handleDeleteDefaultLink = (row: DefaultLinkItem) => {
    setDefaultLinks((prev) => prev.filter((item) => item.url !== row.url));
    setDeleteDefaultLinks((prev) => [...prev, row]);
  };

  const handleOpenStoreDialog = () => {
    storeDialogRef.current?.open();
  };

  const handleSaveDefaultLinks = async () => {
    try {
      const data = {
        links: defaultLinks
          .map((item) => ({
            ai_link: { ...item },
            delete: false,
          }))
          .concat(
            deleteDefaultLinks.map((item) => ({
              ai_link: { ...item },
              delete: true,
            }))
          ),
      };
      await settingApi.default_links.save(data as any);
      message.success(t("message_status.save_success"));
      setVisible(false);
    } catch (error) {
      console.error("Save default links error:", error);
    }
  };

  const handleCloseDefaultLinks = () => {
    setDefaultLinks(originDefaultLinks);
    setDeleteDefaultLinks([]);
  };

  useImperativeHandle(ref, () => ({
    open: () => {
      loadDefaultLinks();
      setDeleteDefaultLinks([]);
      setVisible(true);
    },
    close: () => {
      setVisible(false);
    },
  }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (active.id !== over?.id) {
      setDefaultLinks((prevState) => {
        const activeIndex = prevState.findIndex(
          (record) => record.url === active?.id
        );
        const overIndex = prevState.findIndex(
          (record) => record.url === over?.id
        );
        return arrayMove(prevState, activeIndex, overIndex);
      });
    }
  };

  const columns: TableColumnsType<DefaultLinkItem> = [
    {
      key: "sort",
      align: "center",
      width: 60,
      render: () => <DragHandle />,
    },
    {
      title: t("default_links.website"),
      dataIndex: "name",
      render: (name: string, record: DefaultLinkItem) => (
        <div className="flex items-center gap-2">
          <img className="w-8 h-8 rounded-full" src={record.logo} alt="" />
          <span className="text-sm text-primary">{name}</span>
        </div>
      ),
    },
    {
      title: t("default_links.jump_path"),
      dataIndex: "url",
      ellipsis: true,
    },
    {
      title: t("action.operation"),
      key: "operation",
      width: 100,
      render: (_: any, record: DefaultLinkItem) => (
        <Button
          type="link"
          danger
          onClick={() => handleDeleteDefaultLink(record)}
        >
          {t("action.delete")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Modal
        open={visible}
        title={t("default_links.default_setting")}
        onCancel={() => {
          handleCloseDefaultLinks();
          setVisible(false);
        }}
        footer={
          <Button type="primary" onClick={handleSaveDefaultLinks}>
            {t("action.save")}
          </Button>
        }
        width={800}
        destroyOnHidden
      >
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={defaultLinks.map((i) => i.url)}
            strategy={verticalListSortingStrategy}
          >
            <Table<DefaultLinkItem>
              rowKey="url"
              components={{ body: { row: Row } }}
              columns={columns}
              dataSource={defaultLinks}
              pagination={false}
              loading={loading}
              size="middle"
            />
          </SortableContext>
        </DndContext>
        <Button
          type="primary"
          ghost
          className="!border-none mt-5"
          disabled={defaultLinks.length >= MAX_LINKS_LEN}
          onClick={handleOpenStoreDialog}
        >
          +{t("action.add")}({defaultLinks.length}/{MAX_LINKS_LEN})
        </Button>
      </Modal>
      <StoreDialog
        ref={storeDialogRef}
        showAddManual={false}
        onAdd={handleAddDefaultLink}
      />
    </>
  );
});

LinksDialog.displayName = "LinksDialog";

export default LinksDialog;
