import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  RecordingMemoryEntityDetail,
  RecordingMemoryEntitySchemas,
} from '@/api/modules/recording/types'
import { EntityFormDrawer } from './EntityFormDrawer'

// EntityFormDrawer 依赖的重量级模块在单测里全部 mock,只验证表单 store 行为。
vi.mock('@/api/modules/recording', () => ({
  default: {
    updateMemoryEntity: vi.fn().mockResolvedValue({}),
    createMemoryEntity: vi.fn().mockResolvedValue({}),
    getMemoryEntities: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getMemoryEntity: vi.fn().mockResolvedValue({}),
  },
}))
vi.mock('@/locales', () => ({ t: (key: string) => key }))
vi.mock('@km/shared-components-react', () => ({
  SvgIcon: () => null,
  Search: () => null,
}))
vi.mock('@km/shared-utils', () => ({ getSimpleDateFormatString: () => '' }))

const schema: RecordingMemoryEntitySchemas = [
  {
    type: 'person',
    label: '人物',
    attributes: [
      { key: 'phone', label: '电话' },
      { key: 'title', label: '职位' },
    ],
  },
]

function makeDetail(overrides: Partial<RecordingMemoryEntityDetail>): RecordingMemoryEntityDetail {
  return {
    id: 'entity-1',
    entity_type: 'person',
    canonical_name: '张三',
    summary: '',
    fact_count: 0,
    source_meetings: 0,
    last_fact_at: 0,
    updated_time: 0,
    attributes: {},
    aliases: [],
    first_mentioned_at: 0,
    facts: [],
    relations: [],
    ...overrides,
  }
}

/** 编辑抽屉的公共 props;entity / open 由用例控制。 */
function propsFor(entity: RecordingMemoryEntityDetail | null, open: boolean) {
  return {
    mode: 'edit' as const,
    open,
    entity,
    schema,
    onClose: vi.fn(),
    onSaved: vi.fn(),
  }
}

/**
 * 回归:【bug】空的记忆属性编辑会显示缓存上一个的。
 *
 * form 实例挂在常驻的 EntityFormDrawer 上,destroyOnClose 只销毁字段组件、不清 form store;
 * 而 setFieldsValue 是深合并而非整体替换。先编辑属性有值的实体 A,再编辑属性为空的实体 B 时,
 * B 的属性框会残留 A 的旧值,保存时残留值还会被当成 B 的变更提交。
 */
describe('EntityFormDrawer 属性残留', () => {
  it('先编辑有属性的实体,再编辑属性为空的实体,属性框不残留上一个实体的值', async () => {
    const entityA = makeDetail({
      id: 'entity-a',
      canonical_name: '张三',
      attributes: { phone: '13800000000', title: '总监' },
    })
    const entityB = makeDetail({ id: 'entity-b', canonical_name: '李四', attributes: {} })

    const { rerender } = render(<EntityFormDrawer {...propsFor(entityA, true)} />)

    // 实体 A 的属性值正常回填。
    expect(await screen.findByDisplayValue('13800000000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('总监')).toBeInTheDocument()

    // 关闭 → 重新打开编辑实体 B(属性为空)。
    rerender(<EntityFormDrawer {...propsFor(null, false)} />)
    rerender(<EntityFormDrawer {...propsFor(entityB, true)} />)

    // 名称回填为 B;属性框必须为空,不能残留 A 的 phone/title。
    expect(await screen.findByDisplayValue('李四')).toBeInTheDocument()
    const phoneInput = screen.getByLabelText('电话') as HTMLInputElement
    const titleInput = screen.getByLabelText('职位') as HTMLInputElement
    expect(phoneInput.value).toBe('')
    expect(titleInput.value).toBe('')
  })

  it('新实体只覆盖部分属性时,未覆盖的属性框也不残留上一个实体的值', async () => {
    const entityA = makeDetail({
      id: 'entity-a',
      attributes: { phone: '13800000000', title: '总监' },
    })
    const entityC = makeDetail({ id: 'entity-c', canonical_name: '王五', attributes: { phone: '13900000000' } })

    const { rerender } = render(<EntityFormDrawer {...propsFor(entityA, true)} />)
    expect(await screen.findByDisplayValue('13800000000')).toBeInTheDocument()

    rerender(<EntityFormDrawer {...propsFor(null, false)} />)
    rerender(<EntityFormDrawer {...propsFor(entityC, true)} />)

    // phone 被 C 覆盖;title 在 C 上缺失,必须为空而不是残留 A 的"总监"。
    expect(await screen.findByDisplayValue('13900000000')).toBeInTheDocument()
    const titleInput = screen.getByLabelText('职位') as HTMLInputElement
    expect(titleInput.value).toBe('')
  })

  it('属性为空的实体直接保存,不会把上一个实体的残留属性提交给后端', async () => {
    const updateMemoryEntity = vi.fn().mockResolvedValue(makeDetail({ id: 'entity-b' }))
    vi.mocked(await import('@/api/modules/recording')).default.updateMemoryEntity = updateMemoryEntity

    const entityA = makeDetail({
      id: 'entity-a',
      attributes: { phone: '13800000000', title: '总监' },
    })
    const entityB = makeDetail({ id: 'entity-b', canonical_name: '李四', attributes: {} })

    const { rerender } = render(<EntityFormDrawer {...propsFor(entityA, true)} />)
    expect(await screen.findByDisplayValue('13800000000')).toBeInTheDocument()

    rerender(<EntityFormDrawer {...propsFor(null, false)} />)
    rerender(<EntityFormDrawer {...propsFor(entityB, true)} />)
    expect(await screen.findByDisplayValue('李四')).toBeInTheDocument()

    // antd Button 对两个汉字文本会自动插入空格("保 存"),用正则兼容。
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(updateMemoryEntity).toHaveBeenCalledTimes(1))
    // attributes 无变更时应传 undefined;若残留了 A 的 phone/title,这里会收到脏数据。
    expect(updateMemoryEntity.mock.calls[0][1].attributes).toBeUndefined()
  })
})
