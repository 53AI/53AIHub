import { Table, Button, Tag, Upload, message } from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { Search } from '@km/shared-components-react'
import { useEffect, useState } from 'react'
import { t } from '@/locales'
import { knowledgeApi } from '@/api/modules/knowledge'

interface DocumentItem {
  document_id: number
  library_id: number
  name: string
  type: string
  size: number
  status: number
  chunk_count: number
  created_time: string
}

export function KnowledgeDocument() {
  
  const [loading, setLoading] = useState(false)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [keyword, setKeyword] = useState('')

  // Load documents
  const loadDocuments = async () => {
    setLoading(true)
    try {
      const res = await knowledgeApi.getDocuments({ keyword })
      setDocuments(res.list || [])
    } catch (error) {
      console.error('Load documents error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments()
  }, [keyword])

  const columns = [
    {
      title: t('document.name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('document.type'),
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: t('document.size'),
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => {
        if (size < 1024) return size + ' B'
        if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB'
        return (size / 1024 / 1024).toFixed(2) + ' MB'
      },
    },
    {
      title: t('document.chunk_count'),
      dataIndex: 'chunk_count',
      key: 'chunk_count',
    },
    {
      title: t('status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: number) => {
        const statusMap: Record<number, { color: string; text: string }> = {
          0: { color: 'processing', text: t('document.status.processing') },
          1: { color: 'success', text: t('document.status.completed') },
          2: { color: 'error', text: t('document.status.failed') },
        }
        const { color, text } = statusMap[status] || { color: 'default', text: '--' }
        return <Tag color={color}>{text}</Tag>
      },
    },
    {
      title: t('create_time'),
      dataIndex: 'created_time',
      key: 'created_time',
    },
    {
      title: t('operation'),
      key: 'operation',
      render: () => (
        <div className="flex gap-2">
          <Button type="link">{t('action_view')}</Button>
          <Button type="link" danger>{t('action_delete')}</Button>
        </div>
      ),
    },
  ]

  return (
    <div className="p-6">
      <div className="flex justify-between mb-4">
        <Search
          mode="expanded"
          value={keyword}
          onDebouncedChange={setKeyword}
          placeholder={t('document.search_placeholder')}
          className="w-[300px]"
        />
        <Upload showUploadList={false}>
          <Button type="primary" icon={<UploadOutlined />}>
            {t('action_upload')}
          </Button>
        </Upload>
      </div>
      <Table
        rowKey="document_id"
        columns={columns}
        dataSource={documents}
        loading={loading}
        pagination={false}
      />
    </div>
  )
}

export default KnowledgeDocument