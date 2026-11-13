/**
 * 「添加到」弹窗（shared-business AddAnswerAsMd）的后台 API 适配器。
 *
 * 后台为管理员视角：空间 / 知识库全量列出，不做用户权限过滤
 * （前台适配器才按 viewer / edit_knowledge 过滤）。
 */
import spacesApi from "@/api/modules/spaces";
import librariesApi from "@/api/modules/libraries";
import filesApi from "@/api/modules/files";
import fileBodiesApi from "@/api/modules/file-bodies";
import chunksApi from "@/api/modules/chunks";
import type { AddAnswerAsMdApi } from "@km/shared-business";

export const addAnswerAsMdApi: AddAnswerAsMdApi = {
	async listSpaces() {
		const res = await spacesApi.list({ offset: 0, limit: 100, view: "admin" });
		return res.spaces.map((item) => ({ id: item.id, name: item.name }));
	},

	async listLibraries(spaceId) {
		const list = await librariesApi.list({
			space_id: spaceId,
			offset: 0,
			limit: 999,
		});
		return list.map((item) => ({
			id: String(item.id),
			name: item.name,
			icon: item.icon,
		}));
	},

	async listFiles(libraryId) {
		const list = await filesApi.all({ library_id: libraryId });
		return list.map((item) => ({
			id: item.id,
			path: item.path,
			type: item.type,
			created_time: item.created_time,
			updated_time: item.updated_time,
		}));
	},

	createFile(data) {
		return filesApi.create(data);
	},

	createFileBody(data) {
		return fileBodiesApi.create(data);
	},

	syncChunks(data) {
		return chunksApi.sync(data);
	},
};

export default addAnswerAsMdApi;
