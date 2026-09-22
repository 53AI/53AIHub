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
  type ResourceType,
  type SubjectType,
} from "@/components/Permission/constant";
import { permissionsApi } from "@/api/modules/permissions";
import type { PermissionItem } from "@/api/modules/permissions";
import { getPublicPath } from "@/utils/config";
import type { SpaceItem } from "@/api/modules/spaces/types";

import { t } from "@/locales";

/** 单个资源维度下已存在的权限记录 */
interface PermissionRecord {
  id: number;
  permission: PermissionType;
}

/** 合并后的成员行：知识库（空间）权限与 Wiki 权限取用户合集 */
interface MemberRow {
  key: string;
  subject_type: SubjectType;
  subject_id: number;
  /** 知识库（空间）权限记录，无则为 undefined（显示“未选择”） */
  spacePermission?: PermissionRecord;
  /** Wiki 权限记录，无则为 undefined（显示“未选择”） */
  wikiPermission?: PermissionRecord;
}

export interface MembersTabProps {
  space: SpaceItem;
  onRefresh: () => Promise<void>;
}

/** 过滤掉空间内置角色，仅保留真实成员/分组/全员 */
const isMemberSubject = (item: PermissionItem) =>
  item.subject_type !== SUBJECT_TYPE.space_active &&
  item.subject_type !== SUBJECT_TYPE.space_admin &&
  item.subject_type !== SUBJECT_TYPE.space_user;

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
      const [spaceRes, wikiRes] = await Promise.all([
        permissionsApi.list({
          resource_type: RESOURCE_TYPE.space,
          resource_id: space.id,
        }),
        permissionsApi.list({
          resource_type: RESOURCE_TYPE.wiki,
          resource_id: space.id,
        }),
      ]);

      const rowMap = new Map<string, MemberRow>();
      const ensureRow = (item: PermissionItem): MemberRow | null => {
        if (!isMemberSubject(item)) return null;
        const key = `${item.subject_type}-${item.subject_id}`;
        let row = rowMap.get(key);
        if (!row) {
          row = {
            key,
            subject_type: item.subject_type as SubjectType,
            subject_id: item.subject_id,
          };
          rowMap.set(key, row);
        }
        return row;
      };

      // 知识库（空间）权限：同一主体去重，保留首条
      spaceRes.forEach((item) => {
        const row = ensureRow(item);
        if (row && !row.spacePermission) {
          row.spacePermission = {
            id: item.id,
            permission: item.permission as PermissionType,
          };
        }
      });
      // Wiki 权限：同一主体去重，保留首条
      wikiRes.forEach((item) => {
        const row = ensureRow(item);
        if (row && !row.wikiPermission) {
          row.wikiPermission = {
            id: item.id,
            permission: item.permission as PermissionType,
          };
        }
      });

      setRows([...rowMap.values()]);
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
    async (next: PermissionType, row: MemberRow, resourceType: ResourceType) => {
      const existing =
        resourceType === RESOURCE_TYPE.space
          ? row.spacePermission
          : row.wikiPermission;
      try {
        if (existing?.id) {
          await permissionsApi.update(existing.id, { permission: next });
        } else {
          // 原本“未选择”，选择后创建权限记录
          await permissionsApi.create(resourceType, space.id, {
            permissions: [
              {
                subject_type: row.subject_type,
                subject_id: row.subject_id,
                permission: next,
              },
            ],
          });
        }
        message.success(t("message_status.save_success"));
        await loadPermissions();
      } catch (error) {
        console.error("Permission select error:", error);
      }
    },
    [space.id, loadPermissions],
  );

  /** 选择“未选择”：二次确认后删除该维度的权限记录 */
  const handlePermissionUnselected = useCallback(
    (row: MemberRow, resourceType: ResourceType) => {
      const existing =
        resourceType === RESOURCE_TYPE.space
          ? row.spacePermission
          : row.wikiPermission;
      if (!existing?.id) return;
      Modal.confirm({
        title: t("common.tip"),
        content: t("space.members.unselect_confirm"),
        okText: t("action.confirm"),
        cancelText: t("action_cancel"),
        centered: true,
        onOk: async () => {
          try {
            await permissionsApi.delete(existing.id);
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
            // 同时删除知识库权限与 Wiki 权限两条记录
            const ids = [row.spacePermission?.id, row.wikiPermission?.id].filter(
              (id): id is number => !!id,
            );
            await Promise.all(ids.map((id) => permissionsApi.delete(id)));
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
        permission?: PermissionType;
        wiki_permission?: PermissionType;
      }[];
    }) => {
      if (!data.list.length) return;
      try {
        const tasks: Promise<unknown>[] = [];
        // 知识库权限仅在已选择时创建
        const spaceList = data.list.filter(
          (m) => m.permission !== undefined,
        );
        if (spaceList.length) {
          tasks.push(
            permissionsApi.create(RESOURCE_TYPE.space, space.id, {
              permissions: spaceList.map((m) => ({
                subject_type: m.subject_type,
                subject_id: m.subject_id,
                permission: m.permission as PermissionType,
              })),
            }),
          );
        }
        // Wiki 权限仅在已选择时创建
        const wikiList = data.list.filter(
          (m) => m.wiki_permission !== undefined,
        );
        if (wikiList.length) {
          tasks.push(
            permissionsApi.create(RESOURCE_TYPE.wiki, space.id, {
              permissions: wikiList.map((m) => ({
                subject_type: m.subject_type,
                subject_id: m.subject_id,
                permission: m.wiki_permission as PermissionType,
              })),
            }),
          );
        }
        await Promise.all(tasks);
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
        title: t("space.members.col_knowledge_permission"),
        dataIndex: "spacePermission",
        key: "space_permission",
        align: "center",
        render: (_: PermissionRecord | undefined, record) => (
          <PermissionSelector
            value={record.spacePermission?.permission}
            placeholder={t("space.members.unselected")}
            onSelect={(v) =>
              handlePermissionSelect(v, record, RESOURCE_TYPE.space)
            }
            resourceType={RESOURCE_TYPE.space}
            none
          />
        ),
      },
      {
        title: t("space.members.col_wiki_permission"),
        dataIndex: "wikiPermission",
        key: "wiki_permission",
        align: "center",
        render: (_: PermissionRecord | undefined, record) => (
          <PermissionSelector
            value={record.wikiPermission?.permission}
            placeholder={t("space.members.unselected")}
            unselected
            onUnselected={() =>
              handlePermissionUnselected(record, RESOURCE_TYPE.wiki)
            }
            onSelect={(v) =>
              handlePermissionSelect(v, record, RESOURCE_TYPE.wiki)
            }
            resourceType={RESOURCE_TYPE.wiki}
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
    [t, isCreator, handlePermissionSelect, handlePermissionUnselected, handleDelete],
  );

  return (
    <div className="h-full overflow-y-auto py-2">
      <Table
        rowKey={(record) => record.key}
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
      <MemberSelector showWiki onConfirm={handleMemberConfirm}>
        <Button
          type="link"
          size="small"
          className="!h-7 !px-0 flex items-center gap-1 my-3"
          icon={<SvgIcon name="plus" size={14} color="#2563EB" />}>
          {t("action.add")}
        </Button>
      </MemberSelector>
    </div>
  );
}

export default MembersTab;
