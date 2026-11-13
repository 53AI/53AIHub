/**
 * 「添加到」弹窗（shared-business AddAnswerAsMd）的前台 API 适配器。
 *
 * 空间 / 知识库按当前用户权限过滤（viewer / edit_knowledge），
 * 列表走 cacheManager 缓存——与组件下沉前的前台行为保持一致。
 */
import spacesApi from "@/api/modules/spaces";
import librariesApi from "@/api/modules/libraries";
import filesApi from "@/api/modules/files";
import fileBodiesApi from "@/api/modules/file-bodies";
import chunksApi from "@/api/modules/chunks";
import permissionsApi from "@/api/modules/permissions";
import {
	PERMISSION_TYPE,
	RESOURCE_TYPE,
} from "@/components/KMPermission/constant";
import { cacheManager } from "@km/shared-utils";
import type { AddAnswerAsMdApi } from "@km/shared-business/chat";

export const addAnswerAsMdApi: AddAnswerAsMdApi = {
	async listSpaces() {
		const res = await cacheManager.getOrFetch("spaces_list", () => {
			return spacesApi.list({
				status: 0,
				limit: 100,
				offset: 0,
				view: "user",
			});
		});
		const privateSpaces = res.spaces.filter((item) => !item.visibility);
		let permissionMap: Record<string, number> = {};
		if (privateSpaces.length > 0) {
			permissionMap = await permissionsApi.myBatch({
				resource_type: RESOURCE_TYPE.space,
				resource_ids: privateSpaces.map((item) => item.id),
			});
		}
		return res.spaces
			.filter((item) => {
				if (item.visibility) return true;
				const key = `${RESOURCE_TYPE.space}:${item.id}`;
				return permissionMap[key] >= PERMISSION_TYPE.viewer;
			})
			.map((item) => ({ id: item.id, name: item.name }));
	},

	async listLibraries(spaceId) {
		const list = await cacheManager.getOrFetch(
			`libraries_list_${spaceId}`,
			() => {
				return librariesApi.list({
					space_id: spaceId,
					get_recently: 0,
					limit: 999,
				});
			},
		);
		if (list.length === 0) return [];
		const permissionMap = await permissionsApi.myBatch({
			resource_type: RESOURCE_TYPE.library,
			resource_ids: list.map((item) => item.id),
		});
		return list
			.filter((item) => {
				const key = `${RESOURCE_TYPE.library}:${item.id}`;
				return permissionMap[key] >= PERMISSION_TYPE.edit_knowledge;
			})
			.map((item) => ({
				id: item.id,
				name: item.name,
				icon: item.icon,
			}));
	},

	listFiles(libraryId) {
		return filesApi.all({ library_id: libraryId });
	},

	createFile(data) {
		// shared 接口的 permissions 为 unknown[]，前台 filesApi.create 要求 PermissionItem[]
		return filesApi.create(
			data as Parameters<typeof filesApi.create>[0],
		);
	},

	createFileBody(data) {
		return fileBodiesApi.create(data);
	},

	syncChunks(data) {
		return chunksApi.sync(data);
	},
};

export default addAnswerAsMdApi;
