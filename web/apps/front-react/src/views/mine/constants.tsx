import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import type { MineTabKey } from "./types";

/**
 * Tab 列表
 */
export const MINE_TAB_LIST: { label: string; value: MineTabKey }[] = [
  { label: t("mine.my_favorites"), value: "fav" },
  { label: t("mine.recent_visit"), value: "visit" },
  { label: t("mine.ai_generated"), value: "ai" },
  { label: t("mine.uploaded"), value: "upload" },
  { label: t("mine.recording"), value: "audio" },
];

/**
 * 音频文件接受类型（用于上传）
 */
export const AUDIO_ACCEPT = ".mp3,.m4a,.wav,.flac,.ogg,.aac";

/**
 * 音频文件扩展名（用于上传）
 */
export const AUDIO_UPLOAD_EXTENSIONS = ["mp3", "m4a", "wav", "flac", "ogg", "aac"];

/**
 * 录音文件扩展名（录音生成）
 */
export const RECORDING_EXTENSIONS = ["webm", "m4a"];

/**
 * 双重后缀正则（录音转写文件：xxx.m4a.md, xxx.webm.md）
 */
export const AUDIO_DOUBLE_EXT_REGEX = /\.(mp3|m4a|wav|flac|ogg|aac|webm)\.md$/i;

/**
 * 音频文件扩展名正则（单后缀）
 */
export const AUDIO_EXT_REGEX = /\.(mp3|m4a|wav|flac|ogg|aac|webm|md)$/i;

/**
 * 创建菜单项工厂函数
 */
export const createCreateMenuItems = (handlers: {
  onCreateFolder: () => void;
  onCreateFile: () => void;
}) => [
  {
    key: "create_file",
    label: (
      <div className="flex items-center">
        <img
          className="size-4 mr-1"
          src={getPublicPath("/images/export/new.png")}
          alt=""
        />
        {t("mine.new_file")}
      </div>
    ),
    onClick: handlers.onCreateFile,
  },
  {
    key: "create_folder",
    label: (
      <div className="flex items-center">
        <img
          className="size-4 mr-1"
          src={getPublicPath("/images/export/folder.png")}
          alt=""
        />
        {t("library.create_folder")}
      </div>
    ),
    onClick: handlers.onCreateFolder,
  },
];

/**
 * 导入菜单项工厂函数
 */
export const createImportMenuItems = (handlers: {
  onUploadFile: () => void;
  onUploadFolder: () => void;
}) => [
  {
    key: "upload_file",
    label: (
      <div className="flex items-center">
        <img
          className="size-4 mr-1"
          src={getPublicPath("/images/export/upload_file.png")}
          alt=""
        />
        {t("library.upload_file")}
      </div>
    ),
    onClick: handlers.onUploadFile,
  },
  {
    key: "upload_folder",
    label: (
      <div className="flex items-center">
        <img
          className="size-4 mr-1"
          src={getPublicPath("/images/export/upload_folder.png")}
          alt=""
        />
        {t("library.upload_folder")}
      </div>
    ),
    onClick: handlers.onUploadFolder,
  },
];
