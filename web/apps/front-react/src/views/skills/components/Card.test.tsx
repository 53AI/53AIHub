import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SkillCard from './Card'

const navigate = vi.fn()
const loadMySkillList = vi.fn()
const loadSkillList = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

vi.mock('@km/shared-components-react', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SvgIcon: ({ name }: { name: string }) => <svg data-testid={name} />,
}))

vi.mock('@/components/StarRating', () => ({
  StarRating: ({ value }: { value: number }) => <div data-testid="star-rating">{value}</div>,
}))

vi.mock('@/stores/modules/skills', () => ({
  useSkillsStore: () => ({
    loadMySkillList,
    loadSkillList,
  }),
}))

beforeEach(() => {
  navigate.mockReset()
  loadMySkillList.mockReset()
  loadSkillList.mockReset()
})

const baseSkill = {
  id: 'skill-1',
  eid: 174,
  source_type: 'zip',
  skill_name: 'tencent-meeting-mcp',
  sort: 0,
  display_name: '腾讯会议',
  description: '集成腾讯会议API',
  version: 'v1.0.0',
  usage_guide: '',
  origin_zip_name: '',
  origin_zip_size: 0,
  origin_zip_sha256: '',
  publish_status: 'published',
  admin_status: 'enabled',
  risk_level: 'low',
  score_integrity: 0,
  score_practicality: 0,
  score_safety: 0,
  score_code_quality: 0,
  score_doc_quality: 0,
  scan_message: '',
  created_time: 0,
  updated_time: 0,
  binding_id: 'binding-1',
  added: true,
  binding_status: 'enabled',
} as const

describe('SkillCard', () => {
  it('shows the env settings icon button on my skills cards', () => {
    render(
      createElement(SkillCard, {
        skill: baseSkill,
        type: 'my',
      }),
    )

    expect(screen.getByLabelText('环境变量设置')).toBeInTheDocument()
  })

  it('does not show the env settings button for explore cards', () => {
    render(
      createElement(SkillCard, {
        skill: baseSkill,
        type: 'explore',
      }),
    )

    expect(screen.queryByLabelText('环境变量设置')).not.toBeInTheDocument()
  })
})
