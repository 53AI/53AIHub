/**
 * 时间相关展示工具（问候语、时间段等）
 */

/**
 * 根据当前小时获取对应问候语（中文）
 */
export function getGreetingByTime(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 8) return '早上好'
  if (hour >= 8 && hour < 11) return '上午好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 17) return '下午好'
  if (hour >= 17 && hour < 19) return '傍晚好'
  if (hour >= 19 && hour < 22) return '晚上好'
  if (hour >= 22 && hour < 24) return '夜深了'
  return '凌晨好'
}

