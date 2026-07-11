import { Table, Button, Tag, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Search } from '@km/shared-components-react'
import { useEffect, useState } from 'react'
import { t } from '@/locales'
import { knowledgeApi } from '@/api/modules/knowledge'

interface LibraryItem {
  library_id: number
  space_id: number
  name: string
  description: string
  type: string
  document_count: number
  chunk_count: number
  status: number
  created_time: string
}

export function KnowledgeLibrary() {
  
  const [loading, setLoading] = useState(false)
  const [libraries, setLibraries] = useState<LibraryItem[]>([])
  const [keyword, setKeyword] = useState('')

  // Load libraries
  const loadLibraries = async () => {
    setLoading(true)
    try {
      const res = await knowledgeApi.getLibraries({ keyword })
      setLibraries(res.list || [])
    } catch (error) {
      console.error('Load libraries error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLibraries()
  }, [keyword])

  const columns = [
    {
      title: t('library.name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('library.description'),
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: t('library.type'),
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: t('library.document_count'),
      dataIndex: 'document_count',
      key: 'document_count',
    },
    {
      title: t('library.chunk_count'),
      dataIndex: 'chunk_count',
      key: 'chunk_count',
    },
    {
      title: t('status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: number) => (
        <Tag color={status === 1 ? 'success' : 'default'}>
          {status === 1 ? t('enabled') : t('disabled')}
        </Tag>
      ),
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
          <Button type="link">{t('action_edit')}</Button>
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
          placeholder={t('library.search_placeholder')}
          className="w-[300px]"
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => message.info(t('coming_soon'))}>
          {t('action_add')}
        </Button>
      </div>
      <Table
        rowKey="library_id"
        columns={columns}
        dataSource={libraries}
        loading={loading}
        pagination={false}
      />
    </div>
  )
}

export default KnowledgeLibrary