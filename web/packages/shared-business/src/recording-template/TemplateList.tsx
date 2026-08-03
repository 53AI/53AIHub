import { useMemo, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Button, Empty, Modal, Pagination } from "antd";
import {
  PlusOutlined
} from "@ant-design/icons";
import { Tabs, SvgIcon } from '@km/shared-components-react';
import { recordingTemplateMessages } from "./locales";

export interface TemplateItem {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
}

export interface TemplateCategory {
  id: string;
  name: string;
}

export interface TemplateListModalProps {
  /** Modal 标题 */
  title?: string;
  /** Modal 宽度 */
  width?: number;
  /** Modal 高度 */
  height?: number;
  /** 模板列表数据 */
  templates?: TemplateItem[];
  /** 分类列表 */
  categories?: TemplateCategory[];
  /** 每页显示数量 */
  pageSize?: number;
  /** 是否隐藏管理按钮（添加、分组） */
  hideAdminControls?: boolean;
  /** 按钮文案模式：edit 显示"编辑"，add 显示"添加" */
  actionMode?: "edit" | "add";
  /** 点击添加按钮 */
  onAdd?: () => void;
  /** 点击分组按钮 */
  onGroup?: () => void;
  /** 点击模板操作按钮 */
  onAction?: (template: TemplateItem) => void;
  /** 点击删除按钮 */
  onDelete?: (template: TemplateItem) => void;
  /** 自定义分类切换 */
  onCategoryChange?: (categoryId: string) => void;
  /** 自定义类名 */
  className?: string;
  /** 国际化翻译函数，不传则使用默认中文 */
  t?: (key: string, params?: Record<string, string | number>) => string;
}

export interface TemplateListModalRef {
  open: () => void;
  close: () => void;
}

const PAGE_SIZE = 9;

/** 默认翻译函数：从语言包读取中文 */
const defaultT = (key: string, params?: Record<string, string | number>): string => {
  const parts = `_shared.${key}`.split(".");
  let result: unknown = recordingTemplateMessages["zh-cn"];
  for (const part of parts) {
    if (result && typeof result === "object" && part in (result as Record<string, unknown>)) {
      result = (result as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  let text = typeof result === "string" ? result : key;
  if (params) {
    text = text.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : `{{${paramKey}}}`;
    });
  }
  return text;
};

export const TemplateListModal = forwardRef<TemplateListModalRef, TemplateListModalProps>(
  (
    {
      title,
      width = 1260,
      height = 800,
      templates = [],
      categories = [],
      pageSize = PAGE_SIZE,
      hideAdminControls = false,
      actionMode = "edit",
      onAdd,
      onGroup,
      onAction,
      onDelete,
      onCategoryChange,
      className,
      t = defaultT,
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState(categories[0]?.id || "");
    const [page, setPage] = useState(1);

    // 默认选中第一个分组
    useEffect(() => {
      if (categories.length > 0 && !categories.some((c) => c.id === activeCategory)) {
        setActiveCategory(categories[0].id);
      }
    }, [categories, activeCategory]);

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }));

    const categoryMap = useMemo(() => {
      return new Map(categories.map((cat) => [cat.id, cat.name]));
    }, [categories]);

    const tabItems = useMemo(() => {
      return categories.map((cat) => ({
        key: cat.id,
        label: cat.name,
      }));
    }, [categories]);

    const filteredList = useMemo(() => {
      return templates.filter((item) => item.category === activeCategory);
    }, [templates, activeCategory]);

    const paginatedList = useMemo(() => {
      return filteredList.slice((page - 1) * pageSize, page * pageSize);
    }, [filteredList, page, pageSize]);

    const handleTabChange = (key: string) => {
      setActiveCategory(key);
      setPage(1);
      onCategoryChange?.(key);
    };

    const handleAdd = () => {
      onAdd?.();
    };

    const handleGroup = () => {
      onGroup?.();
    };

    const handleAction = (template: TemplateItem) => {
      onAction?.(template);
    };

    return (
      <Modal
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={width}
        destroyOnClose
        className={className}
        styles={{ container: { height } }}
      >
        <div>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 my-4">
            <Tabs
              items={tabItems}
              activeKey={activeCategory}
              onChange={handleTabChange}
              className="flex-1 index-tabs overflow-hidden"
              extra={
                !hideAdminControls && (
                  <>
                    <Button type="link"  onClick={handleGroup}>
                      {t("recording_template.group")}
                    </Button>
                  </>
                )
              }
            />
            {!hideAdminControls && (
              <div className="flex items-center gap-3 shrink-0">
                <Button type="link" style={{ padding: 0, gap: 4 }} icon={<PlusOutlined />} onClick={handleAdd}>
                  {t("recording_template.add_group")}
                </Button>
              </div>
            )}
          </div>

          {paginatedList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[400px]">
              <Empty description={t("recording_template.empty")} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                {paginatedList.map((template) => (
                  <div
                    key={template.id}
                    className="h-[186px] bg-white border border-[#E6E6E6] rounded-lg p-5 hover:shadow-lg transition-all duration-300 group cursor-pointer flex flex-col relative"
                  >
                    <div className="flex flex-1 items-start gap-3">
                      <div className="flex-none size-12 rounded-lg bg-[#F0F2F5] flex items-center justify-center text-[#2563EB]">
                        <SvgIcon name="file_v3" size={24} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 flex items-center gap-2 overflow-hidden">
                            <h3 className="text-base font-medium text-gray-900 truncate">
                              {template.name}
                            </h3>
                          </div>
                        </div>
                        {/* 分组标签 */}
                        <span className="h-5 inline-flex items-center px-2 text-xs text-theme bg-[#EBF1FF] rounded-sm mt-1">
                          {categoryMap.get(template.category)}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-placeholder line-clamp-2 my-2 flex-1 leading-relaxed">
                      {template.description}
                    </p>

                    <div className={`flex-1 flex items-center justify-end gap-2 ${actionMode === "edit" ? 'opacity-0 group-hover:opacity-100 transition-opacity duration-200' : ''}`}>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(template);
                        }}
                      >
                        {actionMode === "edit" ? t("recording_template.edit") : t("recording_template.add")}
                      </Button>
                      {actionMode === "edit" && (
                        <Button
                          className="hover:!border-red-400"
                          style={{ color: "red" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            Modal.confirm({
                              title: t("recording_template.confirm_delete_title"),
                              content: t("recording_template.confirm_delete_content", { name: template.name }),
                              okText: t("recording_template.confirm_delete_ok"),
                              cancelText: t("recording_template.confirm_delete_cancel"),
                              onOk: () => onDelete?.(template),
                            });
                          }}
                        >
                          {t("recording_template.delete")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4">
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={filteredList.length}
                  onChange={(p) => setPage(p)}
                  showSizeChanger={false}
                  showTotal={(total) => t("recording_template.total", { total })}
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    );
  }
);

export default TemplateListModal;