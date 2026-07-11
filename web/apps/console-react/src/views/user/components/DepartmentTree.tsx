import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { t } from "@/locales";
import {
  Tree,
  Button,
  Dropdown,
  Progress,
  message,
  Modal,
  Spin,
} from "antd";
import {
  PlusOutlined,
  MoreOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import type { TreeDataNode } from "antd";
import { departmentApi, userApi } from "@/api";
import { getPublicPath } from "@/utils/config";
import { wecomApi } from "@/api/modules/wecom";
import dingtalkApi from "@/api/modules/dingtalk";
import {
  ENTERPRISE_SYNC_FROM,
  EnterpriseSyncFrom,
} from "@/constants/enterprise";
import { INTERNAL_USER_STATUS_ALL } from "@/api/modules/user";
import DepartmentAddDialog from "./DepartmentAddDialog";
import { SvgIcon } from "@km/shared-components-react";
import { OpenData } from "@/components/OpenData";

// Types
interface DepartmentNode {
  did: number;
  pdid?: number;
  name: string;
  label: string;
  bind_value: string;
  children?: DepartmentNode[];
  sort?: number;
  index?: number;
  lastIndex?: number;
  value?: string | number;
  key?: string | number;
}

interface Member {
  user_id: number;
  nickname: string;
  name?: string;
  bind_value: string;
  did?: number;
}

interface DepartmentTreeProps {
  syncFrom?: EnterpriseSyncFrom;
  onNodeClick?: (data: { data: DepartmentNode | Member }) => void;
}

export interface DepartmentTreeRef {
  refresh: () => void;
}

export const DepartmentTree = forwardRef<
  DepartmentTreeRef,
  DepartmentTreeProps
>(({ syncFrom = ENTERPRISE_SYNC_FROM.DEFAULT, onNodeClick }, ref) => {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  const [treeData, setTreeData] = useState<DepartmentNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<(string | number)[]>([
    "root",
  ]);
  const [searchDepartments, setSearchDepartments] = useState<DepartmentNode[]>(
    [],
  );
  const [searchMembers, setSearchMembers] = useState<Member[]>([]);

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogData, setAddDialogData] = useState<any>({});

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Computed
  const isSsoSync = useMemo(
    () => syncFrom !== ENTERPRISE_SYNC_FROM.DEFAULT,
    [syncFrom],
  );
  const isWecomSync = useMemo(
    () => syncFrom === ENTERPRISE_SYNC_FROM.WECOM,
    [syncFrom],
  );
  const isDingtalkSync = useMemo(
    () => syncFrom === ENTERPRISE_SYNC_FROM.DINGTALK,
    [syncFrom],
  );
  const isSearch = useMemo(() => !!keyword.trim(), [keyword]);

  // Clear sync timer
  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  // Transform tree data for Ant Design Tree
  const transformTreeData = useCallback(
    (nodes: DepartmentNode[]): TreeDataNode[] => {
      return nodes.map((node, index) => ({
        ...node,
        key: node.bind_value ?? node.did ?? `node-${index}`,
        title: node.name || node.label,
        value: node.bind_value ?? node.did,
        children: node.children ? transformTreeData(node.children) : undefined,
        index,
        lastIndex: nodes.length - 1,
      }));
    },
    [],
  );

  // Fetch department tree
  const fetchDepartmentTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await departmentApi.fetch_department_tree({
        from: syncFrom,
      });
      setTreeData(data || []);
      if (data?.length > 0 && !expandedKeys.includes("root")) {
        setExpandedKeys(["root"]);
      }
    } finally {
      setLoading(false);
    }
  }, [syncFrom]);

  // Fetch department list (for search)
  const fetchDepartmentList = useCallback(async () => {
    setLoading(true);
    try {
      const { list = [] } = await userApi.fetch_internal_user({
        from: syncFrom,
        status: INTERNAL_USER_STATUS_ALL,
        keyword: keyword.trim(),
        offset: 0,
        limit: 10000,
      });

      const rootName = treeData[0]?.name || "";
      setSearchMembers(
        list.map((item: any) => ({
          ...item,
          name: rootName,
        })),
      );
      setSearchDepartments([]);
    } finally {
      setLoading(false);
    }
  }, [syncFrom, keyword, treeData]);

  // Search for SSO
  const searchSsoContacts = useCallback(async () => {
    setLoading(true);
    try {
      if (isWecomSync) {
        const res = await wecomApi.contact_search({ keyword: keyword.trim() });
        const result = res.data?.query_result || {};

        // Search departments
        if (result.party?.department_id?.length) {
          const departments = result.party.department_id.map((id: string) => {
            const found = findNodeByBindValue(treeData, id);
            return found || { bind_value: id, name: id };
          });
          setSearchDepartments(departments);
        } else {
          setSearchDepartments([]);
        }

        // Search members
        if (result.user?.userid?.length) {
          setSearchMembers(
            result.user.userid.map((id: string) => ({
              bind_value: id,
              nickname: id,
            })),
          );
        } else {
          setSearchMembers([]);
        }
      } else if (isDingtalkSync) {
        const list = await dingtalkApi.contact_search({
          keyword: keyword.trim(),
        });
        setSearchMembers(
          list.map((item: any) => ({
            ...item,
            nickname: item.bind_value,
          })),
        );
        setSearchDepartments([]);
      }
    } finally {
      setLoading(false);
    }
  }, [keyword, isWecomSync, isDingtalkSync, treeData]);

  // Find node by bind_value
  const findNodeByBindValue = (
    nodes: DepartmentNode[],
    value: string,
  ): DepartmentNode | null => {
    for (const node of nodes) {
      if (node.bind_value === value) return node;
      if (node.children) {
        const found = findNodeByBindValue(node.children, value);
        if (found) return found;
      }
    }
    return null;
  };

  // Filter departments by keyword (frontend filtering for non-SSO)
  // 保持父子关系：匹配的节点及其祖先节点都会保留
  const filterDepartments = useCallback(
    (nodes: DepartmentNode[], kw: string): DepartmentNode[] => {
      if (!kw) return nodes;

      const filterNode = (node: DepartmentNode): DepartmentNode | null => {
        const matchesKeyword =
          node.name?.includes(kw) || node.bind_value?.includes(kw);

        // 递归过滤子节点
        const filteredChildren = node.children
          ?.map((child) => filterNode(child))
          .filter((child): child is DepartmentNode => child !== null);

        // 如果当前节点匹配，保留该节点及其所有子节点
        if (matchesKeyword) {
          return {
            ...node,
            children: filteredChildren || node.children,
          };
        }

        // 如果子节点有匹配，保留当前节点和匹配的子节点
        if (filteredChildren && filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
          };
        }

        return null;
      };

      return nodes
        .map((node) => filterNode(node))
        .filter((node): node is DepartmentNode => node !== null);
    },
    [],
  );

  // Refresh
  const refresh = useCallback(async () => {
    setSearchMembers([]);
    setSearchDepartments([]);

    if (isSearch) {
      if (isSsoSync) {
        await searchSsoContacts();
      } else {
        const filteredDepts = filterDepartments(treeData, keywordRef.current.trim());
        setSearchDepartments(filteredDepts);
        await fetchDepartmentList();
      }
    } else {
      await fetchDepartmentTree();
    }
  }, [
    isSearch,
    isSsoSync,
    searchSsoContacts,
    fetchDepartmentList,
    fetchDepartmentTree,
    treeData,
    filterDepartments,
  ]);

  // Handle node click
  const handleNodeClick = useCallback(
    (data: DepartmentNode | Member) => {
      onNodeClick?.({ data });
    },
    [onNodeClick],
  );

  // Handle command
  const handleCommand = useCallback(
    async (command: string, data: DepartmentNode, index: number) => {
      const parentChildren = data.children || [];
      const prevData = parentChildren[index - 1] || {};
      const nextData = parentChildren[index + 1] || {};

      switch (command) {
        case "add_children":
          setAddDialogData({
            pdid: data.did,
            parentChildren: data.children,
          });
          setAddDialogOpen(true);
          break;

        case "update_name":
          setAddDialogData({ data });
          setAddDialogOpen(true);
          break;

        case "move_up":
          setLoading(true);
          try {
            await Promise.all([
              departmentApi.save({
                did: data.did,
                name: data.name,
                pdid: data.pdid,
                sort: prevData.sort,
              }),
              departmentApi.save({
                did: prevData.did,
                name: prevData.name,
                pdid: prevData.pdid,
                sort: data.sort,
              }),
            ]);
            message.success(t("action_save_success"));
            refresh();
          } finally {
            setLoading(false);
          }
          break;

        case "move_down":
          setLoading(true);
          try {
            await Promise.all([
              departmentApi.save({
                did: data.did,
                name: data.name,
                pdid: data.pdid,
                sort: nextData.sort,
              }),
              departmentApi.save({
                did: nextData.did,
                name: nextData.name,
                pdid: nextData.pdid,
                sort: data.sort,
              }),
            ]);
            message.success(t("action_save_success"));
            refresh();
          } finally {
            setLoading(false);
          }
          break;

        case "delete":
          Modal.confirm({
            title: t("tip"),
            content: t("internal_user.department.delete_confirm"),
            onOk: async () => {
              setLoading(true);
              try {
                await departmentApi.delete(data.did);
                message.success(t("action_delete_success"));
                refresh();
              } finally {
                setLoading(false);
              }
            },
          });
          break;
      }
    },
    [t, refresh],
  );

  // Load sync progress
  const loadSyncProgress = useCallback(
    (isInited = false) => {
      clearSyncTimer();

      departmentApi.sync_progress(syncFrom).then(async (res: any) => {
        const {
          progress = 1,
          status = "running",
          message: msg = "",
        } = res.data || {};

        if (isInited) {
          if (status === "running") {
            setSyncing(true);
            setSyncProgress(Number(progress));
            syncTimerRef.current = setTimeout(() => loadSyncProgress(), 5000);
          }
        } else if (status === "completed") {
          message.success(msg);
          setSyncing(false);
          setSyncProgress(0);
          await fetchDepartmentTree();
          if (treeData[0]) {
            handleNodeClick(treeData[0]);
          }
        } else if (status === "running") {
          setSyncProgress(Number(progress));
          syncTimerRef.current = setTimeout(() => loadSyncProgress(), 5000);
        } else if (status === "failed") {
          setSyncProgress(Number(progress));
          message.error(t("action_sync_failed"));
        }
      });
    },
    [
      syncFrom,
      clearSyncTimer,
      fetchDepartmentTree,
      treeData,
      handleNodeClick,
      t,
    ],
  );

  // Handle sync department
  const handleSyncDepartment = useCallback(async () => {
    await departmentApi.sync(syncFrom);
    message.success(t("action_sync_start"));
    setSyncing(true);
    loadSyncProgress();
  }, [syncFrom, loadSyncProgress, t]);

  // Tree title render
  const renderTreeTitle = useCallback(
    (nodeData: any) => {
      const { index, lastIndex, ...data } = nodeData;
      const isRoot = !data.did;

      return (
        <div className="h-6 w-full flex items-center gap-2 group pr-2">
          <SvgIcon
            name="department"
            width="16px"
            height="16px"
            color="#57A1FF"
          />
          <div
            className="flex-1 w-0 text-gray-800 text-sm truncate"
            title={data.name}
          >
            <OpenData
              type="departmentName"
              source={syncFrom}
              openid={data.bind_value}
              text={data.name}
            />
          </div>

          {isSsoSync ? (
            <>
              {isRoot && syncing && (
                <div className="w-[100px]">
                  <Progress percent={syncProgress} size="small" />
                </div>
              )}
              {isRoot && (
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSyncDepartment();
                  }}
                  title={t("sso.sync_corp")}
                />
              )}
            </>
          ) : (
            <Dropdown
              menu={{
                items: [
                  {
                    key: "add_children",
                    label: t("internal_user.department.add_children"),
                  },
                  ...(data.did
                    ? [
                        {
                          key: "update_name",
                          label: t("internal_user.department.update_name"),
                        },
                        ...(index > 0
                          ? [
                              {
                                key: "move_up",
                                label: t("internal_user.department.move_up"),
                              },
                            ]
                          : []),
                        ...(index < lastIndex
                          ? [
                              {
                                key: "move_down",
                                label: t(
                                  "internal_user.department.move_down",
                                ),
                              },
                            ]
                          : []),
                        {
                          key: "delete",
                          label: t("internal_user.department.delete"),
                          danger: true,
                        },
                      ]
                    : []),
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  handleCommand(key, data, index);
                },
              }}
              trigger={["click"]}
            >
              <Button
                type="text"
                icon={<MoreOutlined className="rotate-90" />}
                className={`opacity-0 group-hover:opacity-100 ${isSearch ? "invisible" : ""}`}
                onClick={(e) => e.stopPropagation()}
              />
            </Dropdown>
          )}
        </div>
      );
    },
    [
      isSsoSync,
      syncing,
      syncProgress,
      isSearch,
      handleSyncDepartment,
      handleCommand,
      t,
      syncFrom,
    ],
  );

  // Expose refresh
  useImperativeHandle(ref, () => ({
    refresh,
  }));

  // Initialize
  useEffect(() => {
    if (isSsoSync) {
      loadSyncProgress(true);
    }
    fetchDepartmentTree();

    return () => {
      clearSyncTimer();
    };
  }, []);

  // Search on keyword change
  useEffect(() => {
    if (!isSearch) {
      setSearchDepartments([]);
      setSearchMembers([]);
      return;
    }

    const timer = setTimeout(() => {
      if (isSsoSync) {
        searchSsoContacts();
      } else {
        // Filter departments on frontend (like Vue's filterNode)
        const filteredDepts = filterDepartments(treeData, keyword.trim());
        setSearchDepartments(filteredDepts);
        fetchDepartmentList();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword, isSearch, isSsoSync, searchSsoContacts, fetchDepartmentList, filterDepartments, treeData]);

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-4 py-4 flex items-center gap-2">
        <Search
          mode="expanded"
          value={keyword}
          onDebouncedChange={(val) => {
            keywordRef.current = val;
            setKeyword(val);
            refresh();
          }}
          placeholder={t("internal_user.organization.all_search_placeholder")}
          className="flex-1"
        />
        {!isSsoSync && (
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={() => {
              if (treeData[0]) {
                handleCommand("add_children", treeData[0], 0);
              }
            }}
          />
        )}
      </div>

      {/* Tree content */}
      <Spin
        spinning={loading}
        classNames={{
          root: "flex-1",
          container: "h-full",
        }}
      >
        <div className="px-4 min-h-[300px] flex-1 overflow-auto">
          {/* 企业微信搜索时隐藏树；钉钉搜索时保持显示树并过滤 */}
          {!(isWecomSync && isSearch) && (
            <Tree
              key={syncFrom}
              treeData={transformTreeData(
                isSearch && !isWecomSync
                  ? filterDepartments(treeData, keyword.trim())
                  : treeData
              )}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as (string | number)[])}
              onSelect={(_, info) => {
                if (info.node) {
                  handleNodeClick(info.node as unknown as DepartmentNode);
                }
              }}
              titleRender={renderTreeTitle}
              blockNode
            />
          )}
          {/* 搜索结果列表：企业微信显示部门+成员；钉钉只显示成员 */}
          {isSearch && (
            <ul className="pb-4 w-full">
              {/* 企业微信：在搜索结果中显示部门 */}
              {isWecomSync &&
                searchDepartments.map((dept) => (
                  <li
                    key={dept.bind_value}
                    className="w-full flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-50"
                    onClick={() => handleNodeClick(dept)}
                  >
                    <SvgIcon
                      name="department"
                      width="16px"
                      height="16px"
                      color="#57A1FF"
                    />
                    <div
                      className="flex-1 w-0 text-gray-800 text-sm truncate"
                      title={dept.name}
                    >
                      <OpenData
                        type="departmentName"
                        source={syncFrom}
                        openid={dept.bind_value}
                        text={dept.name}
                      />
                    </div>
                  </li>
                ))}
              {searchMembers.map((member) => (
                <li
                  key={member.bind_value}
                  className="w-full flex items-center gap-2 cursor-pointer hover:bg-gray-50"
                  onClick={() => handleNodeClick(member)}
                >
                  <SvgIcon name="member" width="16px" height="16px" />
                  <div
                    className="flex-1 w-0 text-gray-800 text-sm truncate"
                    title={isDingtalkSync ? member.name : member.nickname}
                  >
                    <OpenData
                      type="userName"
                      source={syncFrom}
                      openid={member.bind_value}
                      text={isDingtalkSync ? member.name : member.nickname}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Spin>

      {/* SSO footer */}
      {isSsoSync && (
        <div className="h-11 flex items-center gap-2 px-4 border-t">
          <div className="flex-1 flex items-center gap-1">
            <img
              src={getPublicPath(`/images/sso/${isWecomSync ? "wecom" : "dingtalk"}.png`)}
              className="w-4 h-4"
              alt=""
            />
            <span className="text-sm text-gray-800">
              {isWecomSync
                ? t("sso.wecom.sync_tip")
                : t("sso.dingtalk.sync_tip")}
            </span>
          </div>
          <a
            href={
              isWecomSync
                ? "https://work.weixin.qq.com/login"
                : "https://oa.dingtalk.com/index.htm#/microApp/microAppListNew"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            <SettingOutlined className="text-gray-400 hover:text-gray-600" />
          </a>
        </div>
      )}

      {/* Add Dialog */}
      <DepartmentAddDialog
        open={addDialogOpen}
        data={addDialogData}
        onClose={() => {
          setAddDialogOpen(false);
          setAddDialogData({});
        }}
        onSuccess={(newData?: any) => {
          setAddDialogOpen(false);
          setAddDialogData({});
          refresh();
        }}
      />
    </div>
  );
});

export default DepartmentTree;
