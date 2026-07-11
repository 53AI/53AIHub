import type { RecordingItem, RecordingItemDisplay } from "./type";
import { getSimpleDateFormatString } from '@km/shared-utils';

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 包含值和单位的对象，值保留一位小数
 */
export const formatFileSize = (bytes: number): { value: string; unit: string } => {
  if (bytes < 1024) return { value: String(bytes), unit: "B" };
  if (bytes < 1024 * 1024) return { value: (bytes / 1024).toFixed(1), unit: "KB" };
  if (bytes < 1024 * 1024 * 1024)
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
  return { value: (bytes / (1024 * 1024 * 1024)).toFixed(1), unit: "GB" };
};

/**
 * 格式化时长（毫秒转 HH:mm:ss）
 * @param milliseconds 毫秒数
 * @returns 格式化后的时长字符串，如 "01:23:45"
 */
export const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * 格式化总时长（带单位）
 * @param milliseconds 毫秒数
 * @returns 包含值和单位的对象
 */
export const formatDurationWithUnit = (
  milliseconds: number
): { value: string; unit: string } => {
  const totalSeconds = Math.floor(milliseconds / 1000);

  if (totalSeconds < 60) {
    return { value: String(totalSeconds), unit: "秒" };
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return { value: String(totalMinutes), unit: "分钟" };
  }

  // 小时保留一位小数
  const totalHours = totalSeconds / 3600;
  return { value: totalHours.toFixed(1), unit: "小时" };
};

/**
 * 转换录音列表项为展示格式
 * @param item 原始录音数据
 * @returns 展示格式的录音数据
 */
export const transformRecordingItem = (
  item: RecordingItem
): RecordingItemDisplay => ({
  id: item.id,
  name: item.name,
  file_size: formatFileSize(item.file_size),
  duration: formatDuration(item.duration),
  creator_name: item.creator_name,
  created_time: getSimpleDateFormatString({
    date: item.created_time,
    format: 'YYYY-MM-DD hh:mm',
  }),
  status: item.status,
});

/**
 * 转换录音列表为展示格式
 * @param items 原始录音列表
 * @returns 展示格式的录音列表
 */
export const transformRecordingList = (
  items: RecordingItem[]
): RecordingItemDisplay[] => items.map(transformRecordingItem);
