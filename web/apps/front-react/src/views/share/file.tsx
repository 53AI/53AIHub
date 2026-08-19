import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin, Empty, Button } from 'antd'
import fileSharesApi from '@/api/modules/file-shares'
import { t } from '@/locales'

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
      <div className="w-full h-full flex flex-col items-center justify-center gap-4">
        <Empty description={t('share.link_expired')} />
        <Button type="primary" onClick={() => navigate('/')}>
          {t('common.back_home')}
        </Button>
      </div>
    )
  }

  return null
}

export default ShareFileView
