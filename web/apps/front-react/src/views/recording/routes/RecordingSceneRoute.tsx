import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Spin } from 'antd'
import recordingApi from '@/api/modules/recording'
import { t } from '@/locales'

type SceneStatus = 'loading' | 'empty' | 'error'

/**
 * /recording 索引路由 —— "经营"（安心录默认落地页）。
 *
 * 挂载即按列表默认排序（updated_time）拉取第一个录音文件，
 * 命中后 replace 到 /recording/preview/:fileId，实现"默认查看第一个文件"；
 * 没有文件时右栏渲染空状态（录音 / 导入入口在左栏，仍然可用）。
 *
 * 这里独立发一次 limit=1 的轻量请求而不复用父布局的列表数据：
 * 父列表要等分组标签加载完才开始取数，立即请求可以更快完成跳转。
 */
export function RecordingSceneRoute() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<SceneStatus>('loading')

  useEffect(() => {
    let cancelled = false
    recordingApi
      .getRecordings({ type: 'file', path: '/', offset: 0, limit: 1, sort_by: 'updated_time' })
      .then((res) => {
        if (cancelled) return
        const first = res.data?.[0]
        if (first) {
          navigate(`/recording/preview/${String(first.id)}`, { replace: true })
        } else {
          setStatus('empty')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spin size="large" description="加载中..." />
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <Empty
        description={
          status === 'error' ? '录音列表加载失败，请刷新重试' : t('mine.no_recording_empty')
        }
      />
    </div>
  )
}

export default RecordingSceneRoute
