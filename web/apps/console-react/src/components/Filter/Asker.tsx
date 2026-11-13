import { Select } from 'antd'
import UserFilter from '@/components/Filter/user'
import { t } from '@/locales'

type AskerFilterProps = {
  clearKey?: number
  /** 提取成员的哪个 ID 字段：uid（字符串 ID，问答记录接口用）；user_id（数字 ID，反馈列表接口用） */
  field?: 'uid' | 'user_id'
  /** 触发器前缀文案，默认「提问人」（search-record.user）；反馈页传 search-feedback.user（反馈人） */
  label?: string
  onChange: (value: string | null) => void
}

export default function AskerFilter({
  clearKey = 0,
  field = 'uid',
  label = t('search-record.user'),
  onChange,
}: AskerFilterProps) {
  return (
    <UserFilter
      type="user"
      multiple={false}
      defaultFirstValue={false}
      emptyLabel={t('search-record.all')}
      renderTrigger={(displayLabel) => (
        <Select
          open={false}
          value={displayLabel}
          options={[{ value: displayLabel, label: displayLabel }]}
          className="flex-none min-w-[180px]"
          prefix={<span className="text-placeholder">{label + ':'}</span>}
        />
      )}
      resetKey={clearKey}
      onChange={(users) => {
        const raw = users[0]?.[field]
        onChange(raw !== undefined && raw !== null ? String(raw) : null)
      }}
    />
  )
}
