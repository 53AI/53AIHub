import type { ReactElement } from 'react'
import { SafeImage } from '@km/shared-components-react'
import type { TranscriptItem } from '../../parsers/recordingParsers'

const DEFAULT_SPEAKER_AVATAR = '/images/recording/user.png'

// 与原有录音组件的蓝、绿、橙、紫、青、红配色顺序一致；按说话人编号固定取色。
const SPEAKER_TONES = [
  { avatar: 'bg-blue-100 text-blue-700', name: 'text-blue-700' },
  { avatar: 'bg-green-100 text-green-700', name: 'text-green-700' },
  { avatar: 'bg-orange-100 text-orange-700', name: 'text-orange-700' },
  { avatar: 'bg-purple-100 text-purple-700', name: 'text-purple-700' },
  { avatar: 'bg-cyan-100 text-cyan-700', name: 'text-cyan-700' },
  { avatar: 'bg-red-100 text-red-700', name: 'text-red-700' },
] as const

/** 以绑定标记为准；关联了人员但没有头像 URL 时仍显示原有默认人物图。 */
export function isBoundSpeaker(item: TranscriptItem): boolean {
  return Boolean(item.contactId || item.avatarUrl)
}

/** 为相同编号的说话人返回稳定的背景和姓名色。 */
export function speakerTone(item: TranscriptItem): (typeof SPEAKER_TONES)[number] {
  return SPEAKER_TONES[(Math.max(item.speakerNum, 1) - 1) % SPEAKER_TONES.length]
}

function speakerInitial(speaker: string): string {
  const label = speaker.trim().replace(/^说话人\s*/, '')
  return (label[0] || '?').toUpperCase()
}

type TranscriptSpeakerAvatarProps = {
  item: TranscriptItem
}

/** 会议详情与分享转写共用：未绑定时区分说话人，绑定后保留人物头像。 */
export function TranscriptSpeakerAvatar({ item }: TranscriptSpeakerAvatarProps): ReactElement {
  if (isBoundSpeaker(item)) {
    return (
      <SafeImage
        src={item.avatarUrl || DEFAULT_SPEAKER_AVATAR}
        round={19}
        border={false}
        className="size-[38px]"
      />
    )
  }

  return (
    <span
      data-testid="unbound-speaker-avatar"
      className={`size-[38px] shrink-0 rounded-full inline-flex items-center justify-center text-sm font-semibold ${speakerTone(item).avatar}`}
      aria-label={`${item.speaker}头像`}
    >
      {speakerInitial(item.speaker)}
    </span>
  )
}
