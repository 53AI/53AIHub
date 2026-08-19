/**
 * 用户头像（图片型）— 全项目唯一渲染用户图片头像的方式
 *
 * 新增头像需求必须用本组件，禁止：
 * - 直接使用 `<img src={avatarUrl}>` 渲染用户头像
 * - 直接使用 antd `<Avatar src={avatarUrl}>`（仅在 Suspense 占位场景保留）
 * - 在其它文件里硬写默认 URL（默认 URL 见 `@/constants/user` 的 `DEFAULT_USER_AVATAR`）
 *
 * 三层缺省保护，避免裂图：
 * 1. 传入 src 为空/纯空白 → 用 DEFAULT_USER_AVATAR
 * 2. 加载失败（404 / 网络错误）→ 切到 DEFAULT_USER_AVATAR
 * 3. 默认图本身也加载失败时由浏览器展示 alt，不在此处再兜（避免无限 onError）
 *
 * 文字/首字母头像另用 VirtualLogo，本组件只管图片型。
 */
import { forwardRef, useState, type MouseEventHandler } from 'react'
import { DEFAULT_USER_AVATAR } from '@/constants/user'

export interface UserAvatarProps {
  /** 头像 URL；空串或纯空白视作缺省 */
  src?: string
  /** 像素尺寸，正方形 */
  size?: number
  /** 形状：circle = 圆形（默认），square = 12px 圆角方形 */
  shape?: 'circle' | 'square'
  className?: string
  alt?: string
  /** 透传 click 给底层 <img>，配合外层 className="cursor-pointer" 实现可点击头像 */
  onClick?: MouseEventHandler<HTMLImageElement>
}

// 用 forwardRef 是因为 antd 的 Trigger（Tooltip/Popover/Dropdown）会向子节点
// 注入 ref 以定位弹层；普通函数组件不支持 ref，会触发 "Function components cannot be given refs" 警告。
export const UserAvatar = forwardRef<HTMLImageElement, UserAvatarProps>(function UserAvatar(
  { src, size = 56, shape = 'circle', className = '', alt = '', onClick },
  ref,
) {
  // 用 state 持有 onError 后的回落：onError 必须触发重渲染，否则 src 不刷新
  const [errored, setErrored] = useState(false)
  const resolved = errored || !src?.trim() ? DEFAULT_USER_AVATAR : src

  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-xl'

  return (
    <img
      ref={ref}
      src={resolved}
      alt={alt}
      onError={() => setErrored(true)}
      onClick={onClick}
      width={size}
      height={size}
      className={`object-cover shrink-0 bg-[#F2F3F5] ${shapeClass} ${className}`.trim()}
    />
  )
})

export default UserAvatar
