import { Button, Modal, message } from "antd";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { t } from "@/locales";

/** 导入的用户数据（字段与添加弹窗一致） */
export type ImportedInternalUser = {
	nickname: string;
	username: string;
	password: string;
};

interface UserInternalImportDialogProps {
	open: boolean;
	onClose: () => void;
	/** 解析成功后回调，数据由父组件填充到添加弹窗 */
	onImported: (users: ImportedInternalUser[]) => void;
}

/** 模板表头（与添加弹窗字段一致：姓名/手机/密码） */
const getTemplateHeaders = () => ({
	nickname: t("internal_user.account.name"),
	username: t("internal_user.account.mobile"),
	password: t("password"),
});

export default function UserInternalImportDialog({
	open,
	onClose,
	onImported,
}: UserInternalImportDialogProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);

	// 下载文件模板
	const handleDownloadTemplate = async () => {
		const XLSX = await import("xlsx");
		const headers = getTemplateHeaders();
		const worksheet = XLSX.utils.aoa_to_sheet([
			[headers.nickname, headers.username, headers.password],
		]);
		worksheet["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 20 }];
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
		XLSX.writeFile(
			workbook,
			`${t("internal_user.account.import_template_file")}.xlsx`,
		);
	};

	// 上传并解析文件
	const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		setImporting(true);
		try {
			const XLSX = await import("xlsx");
			const data = await file.arrayBuffer();
			const workbook = XLSX.read(data, { type: "array" });
			const worksheet = workbook.Sheets[workbook.SheetNames[0]];
			if (!worksheet) {
				message.error(t("internal_user.account.import_parse_failed"));
				return;
			}
			const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
				header: 1,
				raw: false,
				defval: "",
			});

			// 按表头定位列
			const headers = getTemplateHeaders();
			const headerRow = (rows[0] ?? []).map((cell) => String(cell).trim());
			const nicknameIndex = headerRow.indexOf(headers.nickname);
			const usernameIndex = headerRow.indexOf(headers.username);
			const passwordIndex = headerRow.indexOf(headers.password);
			if (
				nicknameIndex === -1 ||
				usernameIndex === -1 ||
				passwordIndex === -1
			) {
				message.error(t("internal_user.account.import_invalid_template"));
				return;
			}

			const users: ImportedInternalUser[] = [];
			for (let i = 1; i < rows.length; i++) {
				const row = rows[i] ?? [];
				const nickname = String(row[nicknameIndex] ?? "").trim();
				const username = String(row[usernameIndex] ?? "").trim();
				const password = String(row[passwordIndex] ?? "").trim();
				// 跳过完全空白的行
				if (!nickname && !username && !password) continue;
				users.push({ nickname, username, password });
			}
			if (users.length === 0) {
				message.error(t("internal_user.account.import_empty"));
				return;
			}
			onImported(users);
		} catch (error) {
			console.error("Import internal users error:", error);
			message.error(t("internal_user.account.import_parse_failed"));
		} finally {
			setImporting(false);
			// 允许重复选择同一文件
			event.target.value = "";
		}
	};

	return (
		<Modal
			title={t("internal_user.account.import_title")}
			open={open}
			onCancel={onClose}
			width={550}
			footer={null}
			destroyOnHidden
		>
			<div className="h-14 flex items-center justify-between bg-[var(--color-bg-secondary)] px-6 rounded-sm">
				<div className="text-sm text-dark">
					{t("internal_user.account.import_tip")}
				</div>
				<Button
					color="primary"
					variant="outlined"
					onClick={handleDownloadTemplate}
				>
					{t("internal_user.account.import_download_template")}
				</Button>
			</div>
			<div className="flex-center pt-10 pb-4">
				<Button
					type="primary"
					loading={importing}
					onClick={() => fileInputRef.current?.click()}
				>
					{t("internal_user.account.import_upload")}
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".xlsx,.xls"
					className="hidden"
					onChange={handleFileChange}
				/>
			</div>
		</Modal>
	);
}
