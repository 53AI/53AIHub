import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Modal, Tree, Radio, Empty, Button } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import type { TreeDataNode } from "antd";
import { departmentApi, getRootDepartmentData } from "@/api/modules/department";
import { t } from "@/locales";
import userApi from "@/api/modules/user";
import { groupApi } from "@/api/modules/group";
import { GROUP_TYPE } from "@/constants/group";
import { SvgIcon } from "@km/shared-components-react";
import "./index.css";

interface SelectItem {
  value: number;
  label: string;
  name?: string;
  user_id?: number;
  did?: number;
  type?: "member" | "group";
  dept_id_list?: number[];
}

interface DeptMemberPickerProps {
  value?: SelectItem[];
  onChange?: (value: SelectItem[]) => void;
  type?: "general" | "department" | "user";
  defaultFirstValue?: boolean;
  multiple?: boolean;
  showGroup?: boolean;
  allowSelectAllCompany?: boolean;
  trigger?: React.ReactNode;
  onConfirm?: (value: SelectItem[]) => void;
}

const INTERNAL_USER_STATUS_ALL = -1;

export const DeptMemberPicker = forwardRef<
  { open: () => void; close: () => void },
  DeptMemberPickerProps
>(
  (
    {
      value = [],
      onChange,
      type = "general",
      defaultFirstValue = true,
      multiple = true,
      showGroup = false,
      allowSelectAllCompany = false,
      trigger,
      onConfirm,
    },
    ref,
  ) => {
    const [visible, setVisible] = useState(false);
    const [selectedValue, setSelectedValue] = useState<SelectItem[]>([]);
    const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
    const [groupData, setGroupData] = useState<TreeDataNode[]>([]);
    const [allUserData, setAllUserData] = useState<SelectItem[]>([]);
    const [keyword, setKeyword] = useState("");
    const [selectionMode, setSelectionMode] = useState<"member" | "group">(
      "member",
    );
    const [rootData, setRootData] = useState<SelectItem>({
      value: 0,
      label: "",
      name: "",
    });
    const [loading, setLoading] = useState(false);

    const treeRef = useRef<any>(null);
    const treeGroupRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      open: () => open(),
      close: () => setVisible(false),
    }));

    const setModelValue = (val: SelectItem[] = []) => {
      const newValue = JSON.parse(JSON.stringify(val));
      setSelectedValue(newValue);
      onChange?.(newValue);
    };

    useEffect(() => {
      const init = async () => {
        if (["general", "department", "user"].includes(type)) {
          const root = await getRootDepartmentData();
          setRootData(root);

          if (defaultFirstValue && value.length === 0) {
            setModelValue([root]);
          }

          setLoading(true);
          const [deptTree, users] = await Promise.all([
            departmentApi.fetch_department_tree(),
            ["general", "user"].includes(type)
              ? userApi.fetch_internal_user({
                  status: INTERNAL_USER_STATUS_ALL,
                  offset: 0,
                  limit: 10000,
                })
              : Promise.resolve({ list: [] }),
          ]);
          setLoading(false);

          // 处理用户数据
          const processedUsers: SelectItem[] = (users.list || []).map(
            (item: any) => ({
              ...item,
              value: +item.user_id || 0,
              label: item.nickname || item.name || "",
              type: "member" as const,
            }),
          );
          setAllUserData(processedUsers);

          // 合并用户到部门树
          if (["general", "user"].includes(type)) {
            const mergeUsersIntoTree = (data: any): TreeDataNode => {
              const children = (data.children || []).map((item: any) =>
                mergeUsersIntoTree(item),
              );

              processedUsers.forEach((user: SelectItem) => {
                const deptIdList = user.dept_id_list || [];
                if (
                  deptIdList.includes(data.did) ||
                  (!deptIdList.length && data.did === 0)
                ) {
                  children.push({
                    ...user,
                    key: user.value,
                    title: user.label,
                  });
                }
              });

              return {
                ...data,
                key: data.value,
                title: data.label,
                children,
              };
            };
            setTreeData(deptTree.map((item: any) => mergeUsersIntoTree(item)));
          } else {
            const convertToTreeData = (data: any): TreeDataNode => ({
              ...data,
              key: data.value,
              title: data.label,
              children: (data.children || []).map(convertToTreeData),
            });
            setTreeData(deptTree.map(convertToTreeData));
          }
        }

        if (showGroup) {
          const list = await groupApi.list({
            params: { group_type: GROUP_TYPE.INTERNAL_USER },
          });
          const converted: TreeDataNode[] = list.map((item: any) => ({
            ...item,
            key: item.group_id || item.id,
            title: item.group_name || item.name,
            value: item.group_id || item.id,
            label: item.group_name || item.name,
            type: "group",
          }));
          setGroupData(converted);
        }
      };

      init();
    }, []);

    const open = () => {
      const processedValue = JSON.parse(JSON.stringify(value)).map(
        (item: any = {}) => ({
          ...item,
          value: +item.value || +item.did || +item.user_id || 0,
          label: item.label || item.name || "",
          type: item.type,
          user_id: item.user_id,
        }),
      );
      setSelectedValue(processedValue);
      setVisible(true);
    };

    const close = () => {
      setVisible(false);
    };

    const handleKeywordChange = (val: string) => {
      setKeyword(val);
    };

    const filterNode = (node: TreeDataNode, searchValue: string): boolean => {
      if (!searchValue) return true;
      const data = node as any;
      if (selectionMode === "group") {
        return (
          (data.label || "").includes(searchValue) ||
          (data.group_name || "").includes(searchValue)
        );
      }
      return (
        (data.name || "").includes(searchValue) ||
        (data.label || "").includes(searchValue)
      );
    };

    const handleRemove = (item: SelectItem) => {
      setSelectedValue(selectedValue.filter((i) => i.value !== item.value));
    };

    const handleNodeClick = (data: any) => {
      if (type === "user") {
        if (allowSelectAllCompany) {
          if (!data.user_id && data.value) return;
        } else if (!data.user_id) {
          return;
        }
      }

      if (multiple) {
        if (selectedValue.some((i) => i.value === data.value)) {
          setSelectedValue(selectedValue.filter((i) => i.value !== data.value));
        } else {
          setSelectedValue([...selectedValue, data]);
        }
      } else {
        setSelectedValue([data]);
      }
    };

    const handleNodeClickGroup = (data: any) => {
      if (selectedValue.some((i) => i.value === data.value)) {
        setSelectedValue(selectedValue.filter((i) => i.value !== data.value));
      } else {
        setSelectedValue([...selectedValue, data]);
      }
    };

    const handleConfirm = () => {
      setModelValue(selectedValue);
      onConfirm?.(selectedValue);
      close();
    };

    const handleClear = () => {
      setModelValue([]);
    };

    // 过滤树数据
    const getFilteredTreeData = (
      nodes: TreeDataNode[],
      searchValue: string,
    ): TreeDataNode[] => {
      if (!searchValue) return nodes;

      return nodes.reduce((acc: TreeDataNode[], node) => {
        const data = node as any;
        const label = data.label || "";
        const name = data.name || "";
        const matches =
          label.includes(searchValue) || name.includes(searchValue);

        if (node.children && node.children.length > 0) {
          const filteredChildren = getFilteredTreeData(
            node.children,
            searchValue,
          );
          if (filteredChildren.length > 0 || matches) {
            acc.push({ ...node, children: filteredChildren });
          }
        } else if (matches) {
          acc.push(node);
        }

        return acc;
      }, []);
    };

    const filteredTreeData = getFilteredTreeData(treeData, keyword);
    const filteredGroupData = getFilteredTreeData(groupData, keyword);

    const renderTreeNode = (data: TreeDataNode, isGroup: boolean = false) => {
      const nodeData = data as any;
      const isSelected = selectedValue.some(
        (i) => i.value === nodeData.value || i.value === nodeData.key,
      );
      const isUser = !!nodeData.user_id;

      return (
        <div className="tree-node-content">
          <SvgIcon
            name={isGroup ? "user-group" : isUser ? "member" : "department"}
            width="16px"
            height="16px"
            color={isSelected ? "#3664EF" : "#999"}
          />
          <span
            className={`tree-node-label ${isSelected ? "selected" : ""}`}
            title={nodeData.label}
          >
            {nodeData.label}
          </span>
          {isSelected && <CheckOutlined style={{ color: "#3664EF" }} />}
        </div>
      );
    };

    return (
      <div className="dept-member-picker">
        {trigger ? (
          <div className="trigger-wrapper" onClick={open}>
            {trigger}
          </div>
        ) : (
          <ul className="selected-tags">
            {value.map((item) => (
              <li key={item.value} className="selected-tag">
                <SvgIcon
                  name="department"
                  width="16px"
                  height="16px"
                  color="#57A1FF"
                />
                <span>{item.name || item.label}</span>
              </li>
            ))}
            <Button type="primary" className="px-0" onClick={open}>
              {t(value.length === 0 ? "action_add" : "action_modify")}
            </Button>
          </ul>
        )}

        <Modal
          open={visible}
          title={t("action.select")}
          onCancel={close}
          footer={null}
          width={650}
          destroyOnHidden
          styles={{ body: { padding: "16px 24px" } }}
        >
          <div className="picker-content">
            <div className="picker-left">
              <Search
                mode="expanded"
                placeholder={
                  type === "user"
                    ? t("internal_user.organization.user_search_placeholder")
                    : t(
                        "internal_user.organization.department_search_placeholder",
                      )
                }
                value={keyword}
                onDebouncedChange={handleKeywordChange}
              />

              {showGroup && (
                <Radio.Group
                  value={selectionMode}
                  onChange={(e) => setSelectionMode(e.target.value)}
                  className="mode-radio"
                >
                  <Radio.Button value="member">成员</Radio.Button>
                  <Radio.Button value="group">分组</Radio.Button>
                </Radio.Group>
              )}

              <div className="tree-container">
                {selectionMode === "member" ? (
                  filteredTreeData.length > 0 ? (
                    <Tree
                      ref={treeRef}
                      showLine={false}
                      treeData={filteredTreeData}
                      defaultExpandedKeys={[0]}
                      selectedKeys={[]}
                      style={{
                        "--ant-tree-indent-size": "6px",
                      }}
                      onSelect={(keys, info) => {
                        const nodeData = (info.node as any).data || info.node;
                        handleNodeClick(nodeData);
                      }}
                      titleRender={(node) => renderTreeNode(node, false)}
                    />
                  ) : (
                    <></>
                  )
                ) : filteredGroupData.length > 0 ? (
                  <Tree
                    ref={treeGroupRef}
                    showLine={false}
                    treeData={filteredGroupData}
                    defaultExpandedKeys={[0]}
                    selectedKeys={[]}
                    style={{
                      "--ant-tree-indent-size": "6px",
                    }}
                    onSelect={(keys, info) => {
                      const nodeData = (info.node as any).data || info.node;
                      handleNodeClickGroup(nodeData);
                    }}
                    titleRender={(node) => renderTreeNode(node, true)}
                  />
                ) : (
                  <></>
                )}
              </div>
            </div>

            <div className="picker-right">
              <div className="selected-header">
                <h4>{t("internal_user.scope.selected_title")}</h4>
              </div>
              <div className="selected-list">
                {selectedValue.length === 0 ? (
                  <></>
                ) : (
                  <ul className="selected-items">
                    {selectedValue.map((item) => (
                      <li key={item.value} className="selected-item">
                        {item.type === "member" && (
                          <SvgIcon
                            name={item.user_id ? "member" : "department"}
                            width="12px"
                            height="12px"
                            color="#939499"
                          />
                        )}
                        {item.type === "group" && (
                          <SvgIcon
                            name="user-group"
                            width="16px"
                            height="16px"
                            color="#939499"
                          />
                        )}
                        <span>{item.label}</span>
                        <Button
                          type="default"
                          variant="filled"
                          size="small"
                          shape="circle"
                          style={{ zoom: 0.6 }}
                          icon={<CloseOutlined />}
                          onClick={() => handleRemove(item)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="footer-buttons">
            <Button onClick={close}>{t("action.cancel")}</Button>
            <Button type="primary" onClick={handleConfirm}>
              {t("action.confirm")}
            </Button>
          </div>
        </Modal>
      </div>
    );
  },
);

DeptMemberPicker.displayName = "DeptMemberPicker";

export default DeptMemberPicker;
