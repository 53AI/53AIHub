import { useState, useEffect, useMemo } from "react";
import { TreeSelect } from "antd";
import { t } from "@/locales";
import { departmentApi } from "@/api";

interface DepartmentNode {
  did: number;
  pdid: number;
  name: string;
  label: string;
  value: number;
  children?: DepartmentNode[];
}

interface DepartmentTreeSelectProps {
  value?: number;
  onChange?: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function DepartmentTreeSelect({
  value,
  onChange,
  placeholder,
  disabled = false,
}: DepartmentTreeSelectProps) {
  const [treeData, setTreeData] = useState<DepartmentNode[]>([]);
  const [loading, setLoading] = useState(false);

  // Transform tree data for TreeSelect
  const transformTreeData = (nodes: any[]): DepartmentNode[] => {
    return nodes.map((node) => ({
      did: node.did || 0,
      pdid: node.pdid || 0,
      name: node.name || "",
      label: node.name || node.label || "",
      value: node.did || node.value || 0,
      children: node.children ? transformTreeData(node.children) : undefined,
    }));
  };

  // Fetch department tree
  const fetchDepartmentTree = async () => {
    setLoading(true);
    try {
      const data = await departmentApi.fetch_department_tree();
      setTreeData(transformTreeData(data));
    } catch (error) {
      console.error("Fetch department tree error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter tree node
  const filterTreeNode = (inputValue: string, treeNode: DepartmentNode) => {
    return (treeNode.name || treeNode.label || "").includes(inputValue);
  };

  // Handle change
  const handleChange = (newValue: number) => {
    onChange?.(newValue);
  };

  // Initial load
  useEffect(() => {
    fetchDepartmentTree();
  }, []);

  return (
    <TreeSelect
      value={value}
      onChange={handleChange}
      treeData={treeData}
      placeholder={placeholder || t("internal_user.account.department_placeholder")}
      disabled={disabled}
      loading={loading}
      showSearch
      treeDefaultExpandedKeys={[0]}
      filterTreeNode={filterTreeNode}
      treeNodeFilterProp="label"
      style={{ width: "100%" }}
      allowClear
    />
  );
}
