import { useState, useEffect, useRef } from "react";
import { Spin } from "antd";
import {
  DepartmentTree,
  DepartmentTreeRef,
} from "../components/DepartmentTree";
import { UserMember, MemberRef } from "./Member";
import { getRootDepartmentData } from "@/api/modules/department";

export function UserOrganization() {
  const memberRef = useRef<MemberRef>(null);
  const departmentTreeRef = useRef<DepartmentTreeRef>(null);

  const [loading, setLoading] = useState(true);
  const [organizationData, setOrganizationData] = useState<any>({
    name: "",
    did: 0,
  });

  const handleNodeClick = (data: { data: any }) => {
    setOrganizationData(data.data || {});
    // 不手动调用 refresh()，Member 组件内的 useEffect 会自动响应 department.did 变化
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const rootData = await getRootDepartmentData();
      setOrganizationData({
        name: rootData.name,
        did: rootData.did,
      });
      setLoading(false);
    };
    init();
  }, []);

  return (
    <Spin
      spinning={loading}
      classNames={{
        root: "h-full",
        container: "h-full",
      }}
    >
      <div className="bg-white h-full flex">
        {/* Left: Department Tree */}
        <div className="w-[280px] border-r border-gray-200 flex-shrink-0">
          {!loading && (
            <DepartmentTree
              ref={departmentTreeRef}
              syncFrom="0"
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* Right: Member List */}
        <div className="flex-1 overflow-hidden">
          {!loading && (
            <UserMember
              ref={memberRef}
              syncFrom="0"
              department={organizationData}
              filterParams={{ keyword: organizationData.nickname }}
            />
          )}
        </div>
      </div>
    </Spin>
  );
}

export default UserOrganization;