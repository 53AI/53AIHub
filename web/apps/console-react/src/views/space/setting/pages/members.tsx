import { useState, useEffect, useMemo, useCallback } from "react";
import { Button, Modal, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { SvgIcon, IconAction } from "@km/shared-components-react";

import { EntityDisplay } from "@/components/EntityDisplay";
import { MemberSelector } from "@/components/Permission/member-selector";
import PermissionSelector from "@/components/Permission/selector";
import {
  RESOURCE_TYPE,
  SUBJECT_TYPE,
  type PermissionType,
  type SubjectType,
} from "@/components/Permission/constant";
import { permissionsApi } from "@/api/modules/permissions";
import type { PermissionItem } from "@/api/modules/permissions";
import { getPublicPath } from "@/utils/config";
import type { SpaceItem } from "@/api/modules/spaces/types";

import { t } from "@/locales";

interface MemberRow {
  id: number;
  subject_type: SubjectType;
  subject_id: number;
  permission: PermissionType;
}

export interface MembersTabProps {
  space: SpaceItem;
  onRefresh: () => Promise<void>;
}

export function MembersTab({ space, onRefresh: _onRefresh }: MembersTabProps) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);

  const isCreator = useCallback(
    (subject_id: number) => subject_id === Number(space.owner_id),
    [space.owner_id],
  );

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await permissionsApi.list({
        resource_type: RESOURCE_TYPE.space,
        resource_id: space.id,
      });
      const seen = new Set<string>();
      const list = res
        .filter((item: PermissionItem) => {
          const key = `${item.subject_type}-${item.subject_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .filter(
          (item: PermissionItem) =>
            item.subject_type !== SUBJECT_TYPE.space_active &&
            item.subject_type !== SUBJECT_TYPE.space_admin &&
            item.subject_type !== SUBJECT_TYPE.space_user,
        )
        .map((item: PermissionItem) => ({
          id: item.id,
          subject_type: item.subject_type as SubjectType,
          subject_id: item.subject_id,
          permission: item.permission as PermissionType,
        }));
      setRows(list);
    } catch (error) {
      console.error("Load permissions error:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [space.id]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handlePermissionSelect = useCallback(
    async (next: PermissionType, row: MemberRow) => {
      try {
        if (!row.id) return;
        await permissionsApi.update(row.id, { permission: next });
        message.success(t("message_status.save_success"));
        await loadPermissions();
      } catch (error) {
        console.error("Permission select error:", error);
      }
    },
    [loadPermissions],
  );

  const handleDelete = useCallback(
    (row: MemberRow) => {
      Modal.confirm({
        title: t("common.tip"),
        content: t("space.members.delete_confirm"),
        okText: t("action.confirm"),
        cancelText: t("action_cancel"),
        centered: true,
        onOk: async () => {
          try {
            await permissionsApi.delete(row.id);
            message.success(t("action_delete_success"));
            await loadPermissions();
          } catch (error) {
            console.error("Delete permission error:", error);
          }
        },
      });
    },
    [loadPermissions],
  );

  const handleMemberConfirm = useCallback(
    async (data: {
      list: {
        subject_id: number;
        subject_type: SubjectType;
        permission: PermissionType;
      }[];
    }) => {
      if (!data.list.length) return;
      try {
        await permissionsApi.create(RESOURCE_TYPE.space, space.id, {
          permissions: data.list.map((m) => ({
            subject_type: m.subject_type,
            subject_id: m.subject_id,
            permission: m.permission,
          })),
        });
        message.success(t("message_status.save_success"));
        await loadPermissions();
      } catch (error) {
        console.error("Add members error:", error);
        message.error(t("action.save_failed"));
      }
    },
    [space.id, loadPermissions],
  );

  const columns: ColumnsType<MemberRow> = useMemo(
    () => [
      {
        title: t("space.members.col_user"),
        dataIndex: "subject_type",
        key: "user",
        render: (_: SubjectType, record) => {
          if (record.subject_type === SUBJECT_TYPE.company_all) {
            return (
              <div className="flex items-center gap-2">
                <img
                  src={getPublicPath("/images/space/group.png")}
                  alt={t("space.all_members")}
                  className="size-6"
                />
                <span className="text-sm text-[#1D1E1F]">
                  {t("space.all_members")}
                </span>
              </div>
            );
          }
          return (
            <EntityDisplay
              id={record.subject_id}
              type={
                record.subject_type === SUBJECT_TYPE.group ? "group" : "user"
              }
              mode="full"
            />
          );
        },
      },
      {
        title: t("space.members.col_permission"),
        dataIndex: "permission",
        key: "permission",
        align: "center",
        render: (permission: PermissionType, record) => (
          <PermissionSelector
            value={permission}
            onSelect={(v) => handlePermissionSelect(v, record)}
            none
          />
        ),
      },
      {
        title: t("operation"),
        key: "operation",
        width: 80,
        render: (_, record) => {
          const creatorLocked = isCreator(record.subject_id);
          return (
            <IconAction
              variant="row"
              title={
                creatorLocked
                  ? t("space.members.cannot_delete_creator")
                  : t("action_delete")
              }
              danger
              disabled={creatorLocked}
              onClick={() => handleDelete(record)}
            >
              <SvgIcon name="delete" />
            </IconAction>
          );
        },
      },
    ],
    [t, isCreator, handlePermissionSelect, handleDelete],
  );

  return (
    <div className="h-full overflow-y-auto py-2">
      <Table
        rowKey={(record) =>
          `${record.id}-${record.subject_type}-${record.subject_id}`
        }
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        rowClassName="group"
        components={{
          header: {
            cell: (props: any) => (
              <th {...props} className="!bg-[#F5F6F7] !text-[#999999]" />
            ),
          },
        }}
      />
      <MemberSelector
        onConfirm={handleMemberConfirm}
      >
        <Button type="primary" className="mt-6">
            {t("space.members.add_member")}
          </Button>
      </MemberSelector>
    </div>
  );
}

export default MembersTab;
