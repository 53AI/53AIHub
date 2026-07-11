import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin, Empty } from 'antd'
import fileSharesApi from '@/api/modules/file-shares'

export function ShareFileView() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    loadShareInfo()
  }, [id])

  const loadShareInfo = async () => {
    if (!id) {
      setLoading(false)
      setError(true)
      return
    }

    setLoading(true)
    try {
      const shareInfo = await fileSharesApi.get(id)
      // Redirect to the library file view
      navigate(`/library/${shareInfo.library_id}/file/${shareInfo.id}`, { replace: true })
    } catch (error) {
      console.error('Failed to load share info:', error)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Empty description="分享信息不存在或已过期，请刷新页面重试" />
      </div>
    )
  }

  return null
}

export default ShareFileView
