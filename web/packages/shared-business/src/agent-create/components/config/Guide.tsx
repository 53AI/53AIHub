import { Button, message } from 'antd'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Form, Input } from 'antd'
import { useAgentForm } from '../../hooks'
import { useAgentCreateAdapter } from '../../adapters'
import { SvgIcon } from "@km/shared-components-react"
import { CollapsibleSection } from "../shared/CollapsibleSection"

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
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)
  const generateRandomId = adapter.generateRandomId || ((length: number) => Math.random().toString(36).substring(2, length + 2))
  const ImageUploadComponent = adapter.ImageUploadComponent

  const [useCaseList, setUseCaseList] = useState<UseCase[]>([])
  const [useSceneList, setUseSceneList] = useState<UseCase[]>([])
  const [caseVisible, setCaseVisible] = useState(false)
  const [sceneVisible, setSceneVisible] = useState(false)
  const [caseForm] = Form.useForm()
  const [sceneForm] = Form.useForm()

  const currentCaseRef = useRef<UseCase | null>(null)
  const currentSceneRef = useRef<UseCase | null>(null)

  useEffect(() => {
    const cases = formData.use_cases.filter(item => item.type === 'case')
    setUseCaseList(cases)

    const scenes: UseCase[] = []
    const sceneItems = formData.use_cases.filter(item => item.type === 'scene')
    for (let i = 0; i < 3; i++) {
      scenes.push(
        sceneItems[i] || {
          id: '',
          type: 'scene',
          image: '',
          scene: '',
          desc: '',
        }
      )
    }
    setUseSceneList(scenes)
  }, [formData.use_cases])

  const syncToStore = useCallback((cases: UseCase[], scenes: UseCase[]) => {
    // 保留渠道数据，只更新场景和案例
    const channels = formData.use_cases.filter(item => item.type === 'channel')
    const allCases = [...channels, ...cases, ...scenes].filter(item => item.id)
    updateUseCases(allCases)
  }, [updateUseCases, formData.use_cases])

  useEffect(() => {
    if (caseVisible) {
      const data = currentCaseRef.current
      caseForm.setFieldsValue({
        input_text: data?.input_text || '',
        output_text: data?.output_text || '',
      })
    }
  }, [caseVisible, caseForm])

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
      syncToStore(newCaseList, useSceneList)
      onCaseCancel()
    } catch (error) {
      // Validation failed
    }
  }

  const onSceneOpen = (data?: UseCase) => {
    // 如果是新增（没有传入 data），需要检查是否已达上限
    if (!data) {
      const filledScenes = useSceneList.filter(item => item.id)
      if (filledScenes.length >= 3) {
        message.warning(t('agent.scene_limit_reached'))
        return
      }
    }
    currentSceneRef.current = data || null
    setSceneVisible(true)
  }

  const onSceneDelete = (index: number) => {
    const newList = [...useSceneList]
    newList.splice(index, 1)
    newList.push({
      id: '',
      type: 'scene',
      image: '',
      scene: '',
      desc: '',
    })
    setUseSceneList(newList)
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
      syncToStore(useCaseList, newSceneList)
      onSceneCancel()
    } catch (error) {
      // Validation failed
    }
  }

  return (
    <div>
      <div className="text-sm font-medium text-[#9CA3AF] py-1.5 border-b">{t('agent.usage_help')}</div>
      <CollapsibleSection
        title={t('app.usage_scene')}
        actions={
          <Button color="default" variant="link" className="px-0" onClick={() => onSceneOpen()}>
            <SvgIcon name="plus" size={16} />
          </Button>

        }
      >
        {!useSceneList.some(item => item.id) ? (
          <div className="text-sm text-[#9CA3AF]">{t('agent.guide_scene_tip')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {useSceneList.map((item, index) => (
              item.id && (
                <div
                  key={item.id || index}
                  className="w-full flex justify-between items-center h-10 px-3 bg-white rounded-xl hover:bg-[#EBEEF3] cursor-pointer group"
                >
                  <h6
                    className="text-sm text-[#1D1E1F] max-w-[10em] truncate"
                    title={item.scene || ''}
                  >
                    {item.scene || ''}
                  </h6>
                  <div className="flex gap-2 invisible group-hover:visible">
                    <Button
                      color="default"
                      variant="link"
                      className="px-0"
                      onClick={(e) => { e.stopPropagation(); onSceneOpen(item); }}
                    >
                      <SvgIcon name="setting" />
                    </Button>
                    <Button
                      color="default"
                      variant="link"
                      className="px-0"
                      onClick={(e) => { e.stopPropagation(); onSceneDelete(index); }}
                    >
                      <SvgIcon name="reduce-one" />
                    </Button>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('app.usage_case')}
        actions={
          <Button color="default" variant="link" className="px-0" onClick={() => onCaseOpen()}>
            <SvgIcon name="plus" size={16} />
          </Button>
        }
      >
        {useCaseList.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">{t('agent.guide_case_tip')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {useCaseList.map((item, index) => (
              <div
                key={item.id || index}
                className="w-full flex justify-between items-center h-10 px-3 bg-white rounded-xl hover:bg-[#EBEEF3] cursor-pointer group"
              >
                <div className="text-sm text-[#1D1E1F] break-words">
                  {item.input_text || '--'}
                </div>
                <div className="flex gap-2 invisible group-hover:visible">
                  <Button
                    color="default"
                    variant="link"
                    className="px-0"
                    onClick={(e) => { e.stopPropagation(); onCaseOpen(item); }}
                  >
                    <SvgIcon name="setting" />
                  </Button>

                  <Button
                    color="default"
                    variant="link"
                    className="px-0"
                    onClick={(e) => { e.stopPropagation(); onCaseDelete(index); }}
                  >
                    <SvgIcon name="reduce-one" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <Modal
        open={caseVisible}
        title={currentCaseRef.current?.id ? t('action.edit') : t('action.add')}
        onCancel={onCaseCancel}
        width={600}
        centered
        destroyOnHidden
        footer={
          <>
            <Button className="text-[#1D1E1F]" onClick={onCaseCancel}>
              {t('action.cancel')}
            </Button>
            <Button type="primary" onClick={onCaseConfirm}>
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <Form form={caseForm} labelCol={{ span: 4 }} wrapperCol={{ span: 20 }} labelAlign="left">
          <Form.Item
            label={t('common.input')}
            name="input_text"
            rules={[
              { required: true, message: t('form.input_placeholder') },
              { max: 200, message: t('form_input_placeholder_max_length', { max: 200 }) },
            ]}
          >
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item
            label={t('common.output')}
            name="output_text"
            rules={[
              { required: true, message: t('form.input_placeholder') },
              { max: 1000, message: t('form_input_placeholder_max_length', { max: 1000 }) },
            ]}
          >
            <Input.TextArea rows={10} maxLength={1000} showCount style={{ resize: 'none' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={sceneVisible}
        title={currentSceneRef.current?.id ? t('action.edit') : t('action.add')}
        onCancel={onSceneCancel}
        width={600}
        centered
        destroyOnHidden
        footer={
          <>
            <Button className="text-[#1D1E1F]" onClick={onSceneCancel}>
              {t('action.cancel')}
            </Button>
            <Button type="primary" onClick={onSceneConfirm}>
              {t('action.confirm')}
            </Button>
          </>
        }
      >
        <Form form={sceneForm} labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} labelAlign="left">
          <Form.Item
            label={t('term.pictorial_image')}
            name="image"
            rules={[{ required: true, message: t('form.upload_placeholder') }]}
          >
            {ImageUploadComponent ? (
              <ImageUploadComponent className="!w-[120px] !h-[112px]" />
            ) : (
              <Input placeholder={t('form.upload_placeholder')} />
            )}
          </Form.Item>
          <Form.Item
            label={t('common.scene')}
            name="scene"
            rules={[
              { required: true, message: t('form.input_placeholder') },
              { max: 20, message: t('form_input_placeholder_max_length', { max: 20 }) },
            ]}
          >
            <Input maxLength={20} showCount />
          </Form.Item>
          <Form.Item
            label={t('common.description')}
            name="desc"
            rules={[
              { required: true, message: t('form.input_placeholder') },
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
