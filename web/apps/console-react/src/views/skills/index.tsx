import { SvgIcon, Search, IconAction, SafeImage } from "@km/shared-components-react";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Switch, Table, message, Modal } from "antd";
import type { ColumnsType } from "antd/es/table";
import CreateSkillDialog from "./components/CreateSkillDialog";
import { skillApi } from "@/api/modules/skill";
import { GROUP_TYPE } from "@/constants/group";
import { PublishStatus_TYPE } from "@/api/modules/skill/types";
import type { ScopeItem } from "@/api/modules/agent";
import GroupTabs from "@/components/GroupTabs";
import { PageLayoutContent } from "@/components/PageLayout";
import ScopeDisplay from "@/components/ScopeDisplay";
import { t } from "@/locales";
import { api_host } from "@/utils/config";
import { useListState, useScopeDictionary } from "@/hooks";

const DEFAULT_LOGO = `${api_host}/api/images/skill/logo.png`;

interface SkillItem {
  id: string;
  skill_name: string;
  display_name: string;
  description: string;
  logo?: string;
  group_ids: number[];
  group_names: string[];
  admin_status: "enabled" | "disabled";
  status: number;
  eid: number;
  publish_status: string;
  scopes?: ScopeItem[];
}

interface FilterForm {
  group_id: number[];
  keyword: string;
  page: number;
  page_size: number;
}

export default function Skills() {
  const navigate = useNavigate();
  const groupTabsRef = useRef<any>(null);
  const createSkillRef = useRef<any>(null);

  // 默认状态（稳定引用）
  const defaultFilterForm = useMemo<FilterForm>(() => ({
    group_id: [] as number[],
    keyword: "",
    page: 1,
    page_size: 10,
  }), []);

  // 使用 useListState 管理 URL 持久化状态
  const { state: filterForm, stateRef: filterFormRef, updateState } = useListState<FilterForm>(
    defaultFilterForm,
    {
      enableUrlSync: true,
      urlPrefix: 'skill_',
      searchFields: ['keyword', 'group_id'],
    }
  );

  // 标记是否已初始化
  const initializedRef = useRef(false);

  const [tableData, setTableData] = useState<SkillItem[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  // ScopeDisplay 共享字典:全局 hook 自动 dedup,任意调用方只触发 3 个请求
  const scopeDict = useScopeDictionary();

  const getGroupList = useCallback(() => {
    const options = groupTabsRef.current?.getOptions() || [];
    const idNameMap: Record<number, string> = {};
    if (options?.length > 0) {
      options.forEach((item: any) => {
        idNameMap[item.group_id] = item.group_name;
      });
    }
    return idNameMap;
  }, []);

  const fetchSkillData = useCallback(async () => {
    const { group_id, keyword, page, page_size } = filterFormRef.current;

    setTableLoading(true);
    try {
      const { total = 0, list = [] } = await skillApi.list({
        params: {
          group_id: group_id.join(","),
          keyword,
          offset: (page - 1) * page_size,
          limit: page_size,
        },
      });
      setTableTotal(total);
      const options = getGroupList();
      const data = [...list].map((item: any) => {
        item.status =
          item.admin_status === "enabled"
            ? 1
            : item.admin_status === "disabled"
              ? 0
              : null;
        item.group_ids = item.group_ids || [];
        item.group_names = [];
        item.scopes = item.scopes || [];
        item.group_ids.forEach((id: number) => {
          if (options[id]) {
            item.group_names.push(options[id]);
          }
        });
        item.logo = item.logo || DEFAULT_LOGO;
        return item;
      });
      setTableData(data);
    } finally {
      setTableLoading(false);
    }
  }, [getGroupList]);

  const handleStatusToggle = async (row: SkillItem) => {
    const newStatus = row.status === 1 ? "disabled" : "enabled";
    const oldStatus = row.status;

    setTableData((prev) =>
      prev.map((item) =>
        item.id === row.id
          ? { ...item, status: newStatus === "enabled" ? 1 : 0 }
          : item,
      ),
    );

    try {
      await skillApi.update_status({
        skill_id: row.id,
        admin_status: newStatus,
      });
      message.success(t("action_save_success"));
    } catch (error) {
      setTableData((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, status: oldStatus } : item,
        ),
      );
    }
  };

  const handleMoreCommand = async (command: string, data?: any) => {
    switch (command) {
      case "add":
        createSkillRef.current?.open();
        break;
      case "edit":
        navigate({
          pathname: "/skills/create",
          search: `?skill_id=${data.id}`,
        });
        break;
      case "delete":
        Modal.confirm({
          title: t("tip"),
          content: t("skills.delete_confirm", { skill: data.skill_name }),
          onOk: async () => {
            await skillApi.delete({ skill_id: data.id });
            message.success(t("action_delete_success"));
            fetchSkillData();
          },
        });
        break;
    }
  };

  const onRowClick = (row: SkillItem) => {
    handleMoreCommand("edit", row);
  };

  useEffect(() => {
    const init = async () => {
      initializedRef.current = true;
      fetchSkillData();
    };
    init();
  }, []);

  // 监听 filterForm 变化，自动加载数据
  const filterKey = JSON.stringify(filterForm);
  useEffect(() => {
    if (!initializedRef.current) return;
    fetchSkillData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const columns: ColumnsType<SkillItem> = [
    {
      title: t("name"),
      dataIndex: "skill_name",
      key: "skill_name",
      width: 180,
      render: (_: any, row: SkillItem) => (
        <div className="flex items-center gap-2 w-full">
          <SafeImage
            className="flex-none w-8 h-8 rounded-full overflow-hidden"
            src={row.logo || ""}
            alt=""
          />
          <div className="flex-1 w-0 text-sm flex flex-col">
            <div className="text-primary truncate">{row.skill_name || "--"}</div>
            {row.description && (
              <div className="text-xs text-placeholder truncate">
                {row.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t("skills.display_name"),
      dataIndex: "display_name",
      key: "display_name",
      width: 160,
      ellipsis: true,
      render: (text: string) => (
        <span className={!text ? "text-placeholder" : ""}>{text || "--"}</span>
      ),
    },
    {
      title: t("group"),
      dataIndex: "group_names",
      key: "group_names",
      width: 180,
      ellipsis: true,
      render: (names: string[]) => (
        <span className={!names?.length ? "text-placeholder" : ""}>
          {names?.join("、") || "--"}
        </span>
      ),
    },
    {
      title: t("usage_range"),
      key: "usage_range",
      width: 180,
      ellipsis: true,
      render: (_: any, row: SkillItem) => (
        <ScopeDisplay
          scopes={row.scopes}
          treeData={scopeDict?.treeData}
          users={scopeDict?.users}
          groups={scopeDict?.groups}
        />
      ),
    },
    {
      title: t("action_enable"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (_: any, row: SkillItem) => (
        <div onClick={(e) => e.stopPropagation()}>
          {row.publish_status === PublishStatus_TYPE.draft ? (
            <div>{t("status.draft")}</div>
          ) : (
            <Switch
              checked={row.status === 1}
              onChange={() => handleStatusToggle(row)}
            />
          )}
        </div>
      ),
    },
    {
      title: t("operation"),
      key: "operation",
      width: 100,
      align: "right",
      fixed: "end",
      render: (_: any, row: SkillItem) => (
        <>
          <IconAction
            variant="row"
            title={t("action.edit")}
            onClick={() => handleMoreCommand("edit", row)}
          >
            <SvgIcon name="edit" />
          </IconAction>
          <IconAction
            variant="row"
            title={t("action.delete")}
            danger
            disabled={row.eid === 0}
            onClick={() => handleMoreCommand("delete", row)}
          >
            <SvgIcon name="delete" />
          </IconAction>
        </>
      ),
    },
  ];

  const filterBar = (
    <>
      <div className="flex-1 w-0 flex items-center gap-2">
        <GroupTabs
          className="w-[200px]"
          ref={groupTabsRef}
          value={filterForm.group_id}
          onChange={(ids) => {
            const groupIds = Array.isArray(ids)
              ? ids.map(id => Number(id)).filter(n => !isNaN(n))
              : [Number(ids)].filter(n => !isNaN(n))
            updateState({ group_id: groupIds });
          }}
          type="dropdown"
          groupType={GROUP_TYPE.SKILLS}
        />
        <Search
          mode="expanded"
          className="w-[268px]"
          value={filterForm.keyword}
          debounceMs={300}
          onDebouncedChange={(val) => updateState({ keyword: val })}
          placeholder={t("skills.search_placeholder")}
        />
      </div>
      <div className="flex-none flex items-center gap-3 ml-8">
        <Button type="primary" onClick={() => handleMoreCommand("add")}>
          {t("action_add")}
        </Button>
      </div>
    </>
  );

  return (
    <>
      <PageLayoutContent header={t("module.skills")} filterBar={filterBar}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={tableLoading}
          pagination={{
            current: filterForm.page,
            pageSize: filterForm.page_size,
            total: tableTotal,
            showSizeChanger: true,
            showTotal: (total) => t("table_footer_text", { total }),
            onChange: (page, pageSize) => updateState({ page, page_size: pageSize }),
          }}
          onRow={(record) => ({
            onClick: () => onRowClick(record),
            className: "group cursor-pointer",
          })}
          rowClassName="group cursor-pointer"
        />
      </PageLayoutContent>
      <CreateSkillDialog ref={createSkillRef} />
    </>
  );
}