import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useState, useEffect, useRef, useCallback } from 'react'
import { t } from '@/locales'
import { Modal, Form, Input } from 'antd'
import { useAgentForm } from '../../hooks'
import { generateRandomId } from '@/utils'
import { ImageUpload } from '@/components/Upload/image'
import { SvgIcon } from "@km/shared-components-react"

interface UseCase {
  id: string
  type: 'case' | 'scene'
  input_text?: string
  output_text?: string
  image?: string
  scene?: string
  desc?: string
}

export function AgentGuide() {
  const { formData, updateUseCases } = useAgentForm()

  const [useCaseList, setUseCaseList] = useState<UseCase[]>([])
  const [useSceneList, setUseSceneList] = useState<UseCase[]>([])
  const [caseVisible, setCaseVisible] = useState(false)
  const [sceneVisible, setSceneVisible] = useState(false)
  const [caseForm] = Form.useForm()
  const [sceneForm] = Form.useForm()

  // Use ref to store current editing item to avoid closure issues
  const currentCaseRef = useRef<UseCase | null>(null)
  const currentSceneRef = useRef<UseCase | null>(null)

  // Sync store data to local state (one direction only)
  useEffect(() => {
    const cases = formData.use_cases.filter(item => item.type === 'case')
    setUseCaseList(cases)

    const scenes: UseCase[] = []
    const sceneItems = formData.use_cases.filter(item => item.type === 'scene')
    for (let i = 0; i < 3; i++) {
      scenes.push(
        sceneItems[i] || {
          id: '',
          image: '',
          scene: '',
          desc: '',
        }
      )
    }
    setUseSceneList(scenes)
  }, [formData.use_cases])

  // Helper to sync local state to store (called only on user actions)
  const syncToStore = useCallback((cases: UseCase[], scenes: UseCase[]) => {
    const allCases = [...cases, ...scenes].filter(item => item.id)
    updateUseCases(allCases)
  }, [updateUseCases])

  // Update form when case modal opens
  useEffect(() => {
    if (caseVisible) {
      const data = currentCaseRef.current
      caseForm.setFieldsValue({
        input_text: data?.input_text || '',
        output_text: data?.output_text || '',
      })
    }
  }, [caseVisible, caseForm])

  // Update form when scene modal opens
  useEffect(() => {
    if (sceneVisible) {
      const data = currentSceneRef.current
      sceneForm.setFieldsValue({
        image: data?.image || '',
        scene: data?.scene || '',
        desc: data?.desc || '',
      })
    }
  }, [sceneVisible, sceneForm])

  const onCaseOpen = (data?: UseCase) => {
    currentCaseRef.current = data || null
    setCaseVisible(true)
  }

  const onCaseDelete = (index: number) => {
    const newList = useCaseList.filter((_, i) => i !== index)
    setUseCaseList(newList)
    // Sync to store after state update
    syncToStore(newList, useSceneList)
  }

  const onCaseCancel = () => {
    setCaseVisible(false)
    currentCaseRef.current = null
  }

  const onCaseConfirm = async () => {
    try {
      const values = await caseForm.validateFields()
      const id = currentCaseRef.current?.id || generateRandomId(8)
      const existingData = useCaseList.find(item => item.id === id)

      let newCaseList: UseCase[]
      if (existingData) {
        newCaseList = useCaseList.map(item =>
          item.id === id
            ? { ...item, input_text: values.input_text || '', output_text: values.output_text || '' }
            : item
        )
      } else {
        newCaseList = [
          ...useCaseList,
          {
            type: 'case',
            id,
            input_text: values.input_text || '',
            output_text: values.output_text || '',
          },
        ]
      }
      setUseCaseList(newCaseList)
      // Sync to store immediately when user confirms
      syncToStore(newCaseList, useSceneList)
      onCaseCancel()
    } catch (error) {
      // 验证失败
    }
  }

  const onSceneOpen = (data?: UseCase) => {
    currentSceneRef.current = data || null
    setSceneVisible(true)
  }

  const onSceneDelete = (index: number) => {
    const newList = [...useSceneList]
    newList.splice(index, 1)
    newList.push({
      id: '',
      image: '',
      scene: '',
      desc: '',
    })
    setUseSceneList(newList)
    // Sync to store after state update
    syncToStore(useCaseList, newList)
  }

  const onSceneCancel = () => {
    setSceneVisible(false)
    currentSceneRef.current = null
  }

  const onSceneConfirm = async () => {
    try {
      const values = await sceneForm.validateFields()
      const id = currentSceneRef.current?.id || generateRandomId(8)
      const existingData = useSceneList.find(item => item.id === id)

      let newSceneList: UseCase[]
      if (existingData) {
        newSceneList = useSceneList.map(item =>
          item.id === id
            ? { ...item, image: values.image || '', scene: values.scene || '', desc: values.desc || '' }
            : item
        )
      } else {
        const emptyIndex = useSceneList.findIndex(item => !item.id)
        if (emptyIndex >= 0) {
          newSceneList = [...useSceneList]
          newSceneList[emptyIndex] = {
            type: 'scene',
            id,
            image: values.image || '',
            scene: values.scene || '',
            desc: values.desc || '',
          }
        } else {
          newSceneList = useSceneList
        }
      }
      setUseSceneList(newSceneList)
      // Sync to store immediately when user confirms
      syncToStore(useCaseList, newSceneList)
      onSceneCancel()
    } catch (error) {
      // 验证失败
    }
  }

  return (
    <div>
      <div className="p-5 bg-[#F7F8FA] rounded">
        <div className="flex items-center justify-between">
          <h4 className="text-sm text-secondary">
            {t('usage_scene')}
          </h4>
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={(e) => { e.stopPropagation(); onSceneOpen(); }}
            className="text-primary"
          >
            {t('action_add')}
          </Button>
        </div>
        <div className="flex flex-wrap justify-between">
          {useSceneList.map((item, index) => (
            item.id && (
              <div
                key={item.id || index}
                className="w-full flex justify-between items-center py-[10px] px-3 mt-2 bg-white rounded"
              >
                <h6
                  className="text-sm text-primary max-w-[10em] truncate"
                  title={item.scene || ''}
                >
                  {item.scene || ''}
                </h6>
                <div className="flex gap-2">
                  <Button
                    type="link"
                    icon={<SvgIcon name="edit" />}
                    onClick={(e) => { e.stopPropagation(); onSceneOpen(item); }}
                  />
                  <Button
                    type="link"
                    icon={<SvgIcon name="delete" />}
                    onClick={(e) => { e.stopPropagation(); onSceneDelete(index); }}
                  />
                </div>
              </div>
            )
          ))}
        </div>
      </div>

      <div className="p-5 bg-[#F7F8FA] rounded mt-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm text-secondary">
            {t('usage_case')}
          </h4>
          <Button
            type="link"
            icon={<PlusOutlined />}
            onClick={(e) => { e.stopPropagation(); onCaseOpen(); }}
            className="text-primary"
          >
            {t('action_add')}
          </Button>
        </div>
        <div className="flex flex-wrap">
          {useCaseList.map((item, index) => (
            <div
              key={item.id || index}
              className="w-full flex justify-between items-center py-[10px] px-3 mt-2 bg-white rounded break-inside-avoid"
            >
              <div className="text-sm text-primary break-words">
                {item.input_text || '--'}
              </div>
              <div className="flex gap-2">
                <Button
                  type="link"
                  icon={<SvgIcon name="edit" />}
                  onClick={(e) => { e.stopPropagation(); onCaseOpen(item); }}
                />
                <Button
                  type="link"
                  icon={<SvgIcon name="delete" />}
                  onClick={(e) => { e.stopPropagation(); onCaseDelete(index); }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={caseVisible}
        title={currentCaseRef.current?.id ? t('action_edit') : t('action_add')}
        onCancel={onCaseCancel}
        width={600}
        centered
        destroyOnHidden
        footer={
          <>
            <Button className="text-primary" onClick={onCaseCancel}>
              {t('action_cancel')}
            </Button>
            <Button type="primary" onClick={onCaseConfirm}>
              {t('action_confirm')}
            </Button>
          </>
        }
      >
        <Form form={caseForm} labelCol={{ span: 4 }} wrapperCol={{ span: 20 }} labelAlign="left">
          <Form.Item
            label={t('input')}
            name="input_text"
            rules={[
              { required: true, message: t('form_input_placeholder') },
              { max: 200, message: t('form_input_placeholder_max_length', { max: 200 }) },
            ]}
          >
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item
            label={t('output')}
            name="output_text"
            rules={[
              { required: true, message: t('form_input_placeholder') },
              { max: 1000, message: t('form_input_placeholder_max_length', { max: 1000 }) },
            ]}
          >
            <Input.TextArea rows={10} maxLength={1000} showCount style={{ resize: 'none' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={sceneVisible}
        title={currentSceneRef.current?.id ? t('action_edit') : t('action_add')}
        onCancel={onSceneCancel}
        width={600}
        centered
        destroyOnHidden
        footer={
          <>
            <Button className="text-primary" onClick={onSceneCancel}>
              {t('action_cancel')}
            </Button>
            <Button type="primary" onClick={onSceneConfirm}>
              {t('action_confirm')}
            </Button>
          </>
        }
      >
        <Form form={sceneForm} labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} labelAlign="left">
          <Form.Item
            label={t('pictorial_image')}
            name="image"
            rules={[{ required: true, message: t('form_upload_placeholder') }]}
          >
            <ImageUpload className="!w-[120px] !h-[112px]" />
          </Form.Item>
          <Form.Item
            label={t('scene')}
            name="scene"
            rules={[
              { required: true, message: t('form_input_placeholder') },
              { max: 20, message: t('form_input_placeholder_max_length', { max: 20 }) },
            ]}
          >
            <Input maxLength={20} showCount />
          </Form.Item>
          <Form.Item
            label={t('description')}
            name="desc"
            rules={[
              { required: true, message: t('form_input_placeholder') },
              { max: 50, message: t('form_input_placeholder_max_length', { max: 50 }) },
            ]}
          >
            <Input.TextArea rows={5} maxLength={50} showCount style={{ resize: 'none' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AgentGuide
