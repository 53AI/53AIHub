import { useState, useEffect } from 'react'
import { message, Tag, Spin } from 'antd'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import enterpriseApi from '@/api/modules/enterprise/index'
import type { RawEnterpriseInfo } from '@/api/modules/enterprise/types'
import './EnterpriseChange.css'

interface EnterpriseChangeProps {
  onClose?: () => void
}

export function EnterpriseChange({ onClose }: EnterpriseChangeProps) {
  const enterpriseStore = useEnterpriseStore()
  const [enterpriseList, setEnterpriseList] = useState<RawEnterpriseInfo[]>([])
  const [loading, setLoading] = useState(false)

  const loadEnterpriseList = async () => {
    setLoading(true)
    try {
      const { details = [] } = await enterpriseApi.saasList({ status: 1 })
      setEnterpriseList(details)
    } catch (error) {
      console.error('Failed to load enterprise list:', error)
    } finally {
      setLoading(false)
    }
  }

  // 切换企业
  const handleEnterpriseSelect = async (data: RawEnterpriseInfo) => {
    const { apply_info } = data
    const currentApplyId = enterpriseStore.apply_info?.apply_id

    if (currentApplyId === apply_info.apply_id) {
      onClose?.()
      return
    }

    // 审核中
    if (apply_info.status === 0) {
      message.warning('审核中')
      return
    }

    // 已拒绝
    if (apply_info.status === 2) {
      message.warning(apply_info.reason || '已拒绝')
      return
    }

    // 已过期
    if (apply_info.expired_time && apply_info.expired_time < Date.now() / 1000) {
      return
    }

    try {
      await enterpriseApi.saasDetail(String(data.enterprise.id))
      window.location.hash = '#/'
      window.location.reload()
    } catch (error) {
      console.error('Failed to switch enterprise:', error)
    }
  }

  useEffect(() => {
    loadEnterpriseList()
  }, [])

  return (
    <div className="w-[300px] min-h-12 max-h-[325px] overflow-y-auto rounded-md p-2 bg-white shadow-[0_3px_8px_rgba(22,23,26,0.16)]">
      <Spin spinning={loading}>
        <ul className="w-full flex flex-col gap-3">
          {enterpriseList.map((item) => {
            const isSelected = enterpriseStore.apply_info?.apply_id === item.apply_info.apply_id
            const isAdmin = item.apply_info.user_id === item.enterprise.id

            return (
              <li
                key={item.apply_info.apply_id}
                className={`flex items-center rounded px-3 py-2 cursor-pointer hover:bg-[#f5f5f5] relative group ${
                  isSelected ? 'border-2 border-blue-500 bg-[#F5F8FF] text-[#2563EB]' : ''
                }`}
                onClick={() => handleEnterpriseSelect(item)}
              >
                <img
                  className="flex-none mr-4 w-[32px] h-[32px] object-cover rounded"
                  src={item.enterprise.logo}
                  alt={item.enterprise.display_name}
                />
                <div className="w-[210px] mr-1">
                  <div className="max-w-64 text-sm truncate flex items-center justify-between gap-2">
                    <span className="max-w-[210px] truncate">
                      {item.enterprise.display_name || '- -'}
                    </span>
                    {isAdmin && (
                      <Tag color="warning" className="text-xs">
                        管理员
                      </Tag>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </Spin>
    </div>
  )
}

export default EnterpriseChange
