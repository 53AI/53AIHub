import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../parsers/recordingParsers'
import { TranscriptSpeakerAvatar, isBoundSpeaker, speakerTone } from './TranscriptSpeakerAvatar'

function makeItem(speaker: string, speakerNum: number, contactId?: string, avatarUrl?: string): TranscriptItem {
  return { id: `${speaker}-${speakerNum}`, speaker, speakerNum, time: '00:00:01', seconds: 1, content: '你好', contactId, avatarUrl }
}

describe('TranscriptSpeakerAvatar', () => {
  it('A/B/C/D 及重复出现的同一说话人使用固定的不同头像底色', () => {
    const items = ['A说话人', 'B说话人', 'C说话人', 'D说话人'].map((name, i) => makeItem(name, i + 1))
    expect(new Set(items.map(item => speakerTone(item).avatar)).size).toBe(4)
    expect(speakerTone(items[0])).toEqual(speakerTone(makeItem('A说话人', 1)))
    for (const item of items) {
      const { unmount } = render(<TranscriptSpeakerAvatar item={item} />)
      const avatar = screen.getByTestId('unbound-speaker-avatar')
      expect(avatar.className).toContain(speakerTone(item).avatar)
      expect(avatar.textContent).toBe(item.speaker[0])
      unmount()
    }
  })

  it('说话人B 格式的头像仍使用 B 作为标识', () => {
    render(<TranscriptSpeakerAvatar item={makeItem('说话人B', 2)} />)
    expect(screen.getByTestId('unbound-speaker-avatar').textContent).toBe('B')
  })

  it('有联系人 ID 或头像 URL 的已绑定人物继续使用图片', () => {
    for (const item of [makeItem('张三', 1, 'contact-1'), makeItem('李四', 2, undefined, 'https://example.com/u.png')]) {
      expect(isBoundSpeaker(item)).toBe(true)
      const { container, unmount } = render(<TranscriptSpeakerAvatar item={item} />)
      expect(container.querySelector('[data-testid="unbound-speaker-avatar"]')).toBeNull()
      unmount()
    }
  })
})
