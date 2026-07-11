import { useState, useEffect } from "react";
import { Button, Table, Modal, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { permissionsApi, type PermissionItem } from "@/api/modules/permissions";
import { RolePopover, MemberSelector } from "@/components/KMPermission";
import {
  RESOURCE_TYPE,
  SUBJECT_TYPE,
  PERMISSION_TYPE,
} from "@/components/KMPermission/constant";
import { EntityDisplay } from "@/components/EntityDisplay";
import { useLibraryStore, useUserStore } from "@/stores";
import { Header } from "@/components/Header";
import { getPublicPath } from "@/utils/config";
import type { ColumnsType } from "antd/es/table";

// Default permissions for library
const getLibraryDefault = (): PermissionItem[] => [
  {
    id: 0,
    created_time: 0,
    eid: "",
    resource_id: "",
    resource_type: RESOURCE_TYPE.library,
    subject_id: 0,
    subject_type: SUBJECT_TYPE.space_admin,
    permission: PERMISSION_TYPE.inherit,
    updated_time: 0,
  },
  {
    id: 0,
    created_time: 0,
    eid: "",
    resource_id: "",
    resource_type: RESOURCE_TYPE.library,
    subject_id: 0,
    subject_type: SUBJECT_TYPE.space_user,
    permission: PERMISSION_TYPE.inherit,
    updated_time: 0,
  },
];

export function LibraryPermissionSettingsView() {
  const libraryStore = useLibraryStore();
  const userStore = useUserStore();
  const [tableData, setTableData] = useState<PermissionItem[]>([]);
  const [spaceAdminList, setSpaceAdminList] = useState<PermissionItem[]>([]);
  const [spaceUserList, setSpaceUserList] = useState<PermissionItem[]>([]);

  const isSpacePermission = (subject_type: number) => {
    return [SUBJECT_TYPE.space_admin, SUBJECT_TYPE.space_user].includes(
      subject_type,
    );
  };

  const isSelf = (subject_id: number) => {
    return subject_id === userStore.info.user_id;
  };

  const loadPermissionDetail = async () => {
    if (!libraryStore.library?.id) return;
    const res = await permissionsApi.detail({
      resource_type: RESOURCE_TYPE.library,
      resource_id: libraryStore.library.id,
    });
    setSpaceAdminList(res.team_admin);
    setSpaceUserList(res.team_member);
  };

  const loadPermission = async () => {
    if (!libraryStore.library?.id) return;
    const defaultPermissions = getLibraryDefault();
    const list = await permissionsApi.list({
      resource_type: RESOURCE_TYPE.library,
      resource_id: libraryStore.library.id,
    });

    const admin = list.find(
      (item) => item.subject_type === SUBJECT_TYPE.space_admin,
    );
    const user = list.find(
      (item) => item.subject_type === SUBJECT_TYPE.space_user,
    );
    if (!admin) {
      list.unshift(defaultPermissions[0]);
    }
    if (!user) {
      list.unshift(defaultPermissions[1]);
    }
    list.sort((a, b) => b.subject_type - a.subject_type);
    setTableData(list);
  };

  const handleMemberConfirm = async (data: { list: any[] }) => {
    if (!libraryStore.library?.id) return;
    const permissions = data.list
      .filter((child) => {
        if (
          tableData.some(
            (item) =>
              item.subject_id === child.subject_id &&
              item.subject_type === child.subject_type,
          )
        )
          return false;
        return true;
      })
      .map((item) => ({
        subject_id: item.subject_id,
        subject_type: item.subject_type,
        permission: item.permission,
      }));

    await permissionsApi.create(
      RESOURCE_TYPE.library,
      libraryStore.library.id,
      {
        permissions,
      },
    );
    loadPermission();
    message.success("保存成功");
  };

  const handlePermissionSelect = async (
    permission: number,
    row: PermissionItem,
  ) => {
    if (!libraryStore.library?.id) return;

    if (isSpacePermission(row.subject_type)) {
      if (permission === PERMISSION_TYPE.inherit) {
        if (row.id) {
          await permissionsApi.delete(row.id);
          loadPermission();
        }
      } else {
        if (row.id) {
          await permissionsApi.update(row.id, { permission });
          loadPermission();
          message.success("保存成功");
        } else {
          await permissionsApi.create(
            RESOURCE_TYPE.library,
            libraryStore.library.id,
            {
              permissions: [
                {
                  subject_type: row.subject_type,
                  subject_id: row.subject_id,
                  permission: permission,
                },
              ],
            },
          );
          loadPermission();
          message.success("保存成功");
        }
      }
    } else {
      if (row.id) {
        await permissionsApi.update(row.id, { permission });
        loadPermission();
        message.success("保存成功");
      }
    }
  };

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: "提示",
      content: "确定删除该用户吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        await permissionsApi.delete(id);
        loadPermission();
      },
    });
  };

  useEffect(() => {
    loadPermission();
    loadPermissionDetail();
  }, [libraryStore.library?.id]);

  const columns: ColumnsType<PermissionItem> = [
    {
      title: "用户",
      dataIndex: "name",
      key: "name",
      render: (_, record) => {
        if (record.subject_type === SUBJECT_TYPE.space_admin) {
          return (
            <div className="flex items-center gap-2">
              <img
                src={getPublicPath("/images/library/group.png")}
                alt="admin"
                className="size-6"
              />
              <span className="text-sm text-[#1D1E1F]">
                所属团队空间的管理员({spaceAdminList.length})
              </span>
            </div>
          );
        }
        if (record.subject_type === SUBJECT_TYPE.space_user) {
          return (
            <div className="flex items-center gap-2">
              <img
                src={getPublicPath("/images/library/group.png")}
                alt="admin"
                className="size-6"
              />
              <span className="text-sm text-[#1D1E1F]">
                所属团队空间的成员({spaceUserList.length})
              </span>
            </div>
          );
        }
        if (record.subject_type === SUBJECT_TYPE.company_all) {
          return (
            <div className="flex items-center gap-2">
              <img
                src={getPublicPath("/images/space/group.png")}
                alt="全体成员"
                className="size-6"
              />
              <span className="text-sm text-[#1D1E1F]">全体成员</span>
            </div>
          );
        }
        return (
          <EntityDisplay
            id={record.subject_id}
            type={record.subject_type === SUBJECT_TYPE.user ? "user" : "group"}
            mode="full"
          />
        );
      },
    },
    {
      title: "权限",
      dataIndex: "permission",
      key: "permission",
      render: (permission, record) => (
        <RolePopover
          value={permission}
          onSelect={(value) => handlePermissionSelect(value, record)}
          inherit={isSpacePermission(record.subject_type)}
          none={true}
          disabled={isSelf(record.subject_id)}
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 80,
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          disabled={
            isSelf(record.subject_id) || isSpacePermission(record.subject_type)
          }
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(record.id)}
        />
      ),
    },
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="成员与权限" />
      <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
        <Table
          className="mt-6"
          columns={columns}
          dataSource={tableData}
          rowKey={(record) => `${record.id}-${record.subject_type}`}
          pagination={false}
          components={{
            header: {
              cell: (props: any) => (
                <th {...props} className="!bg-[#F5F6F7] !text-[#999999]" />
              ),
            },
          }}
        />
        <MemberSelector
          trigger={
            <Button type="primary" className="mt-6">
              添加成员
            </Button>
          }
          onConfirm={handleMemberConfirm}
        />
      </div>
    </div>
  );
}

export default LibraryPermissionSettingsView;
