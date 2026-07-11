import { Button, message, Modal, Form, Input } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { t } from "@/locales";
import { usePromptFormDataStore } from "./store";
import { ImageUpload } from "@/components/Upload";
import { generateRandomId } from "@/utils";

interface UseCase {
  id: string;
  type: 'case' | 'scene';
  input_text?: string;
  output_text?: string;
  image?: string;
  scene?: string;
  desc?: string;
}

// 折叠面板组件（参考 CollapsibleSection）
interface CollapsibleSectionProps {
  title: string;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}

function CollapsibleSection({
  title,
  actions,
  defaultExpanded = false,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  return (
    <div className="border-b">
      <div
        className="h-11 flex items-center gap-2 cursor-pointer hover:bg-[#F5F5F7]"
        onClick={handleToggle}
      >
        <SvgIcon name={expanded ? 'down' : 'right'} color="#9CA3AF" />
        <div className="flex-1 text-sm text-[#373A3D] font-medium">
          {title}
        </div>
        {actions && (
          <div onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {expanded && (
        <div className="pt-1 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function GuideView() {
  const [caseVisible, setCaseVisible] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(false);
  const [caseForm] = Form.useForm();
  const [sceneForm] = Form.useForm();
  const [useCaseList, setUseCaseList] = useState<UseCase[]>([]);
  const [useSceneList, setUseSceneList] = useState<UseCase[]>([]);

  const currentCaseRef = useRef<UseCase | null>(null);
  const currentSceneRef = useRef<UseCase | null>(null);

  const formData = usePromptFormDataStore((state) => state.formData);
  const setFormData = usePromptFormDataStore((state) => state.set);

  useEffect(() => {
    const cases = formData.custom_config?.use_cases?.filter((item: UseCase) => item.type === 'case') || [];
    setUseCaseList(cases);

    const sceneItems = formData.custom_config?.use_cases?.filter((item: UseCase) => item.type === 'scene') || [];
    // Load all scenes from data, pad with placeholders to minimum 3 for display
    const scenes: UseCase[] = [...sceneItems];
    while (scenes.length < 3) {
      scenes.push({
        id: '',
        type: 'scene',
        image: '',
        scene: '',
        desc: '',
      });
    }
    setUseSceneList(scenes);
  }, [formData.custom_config?.use_cases]);

  const syncToStore = useCallback((cases: UseCase[], scenes: UseCase[]) => {
    const allCases = [...cases, ...scenes].filter((item) => item.id);
    setFormData({
      custom_config: {
        use_cases: allCases as any,
      },
    });
  }, [setFormData]);

  useEffect(() => {
    if (caseVisible) {
      const data = currentCaseRef.current;
      caseForm.setFieldsValue({
        input_text: data?.input_text || '',
        output_text: data?.output_text || '',
      });
    }
  }, [caseVisible, caseForm]);

  useEffect(() => {
    if (sceneVisible) {
      const data = currentSceneRef.current;
      sceneForm.setFieldsValue({
        image: data?.image || '',
        scene: data?.scene || '',
        desc: data?.desc || '',
      });
    }
  }, [sceneVisible, sceneForm]);

  const onCaseOpen = (data?: UseCase) => {
    currentCaseRef.current = data || null;
    setCaseVisible(true);
  };

  const onCaseDelete = (index: number) => {
    const newList = useCaseList.filter((_, i) => i !== index);
    setUseCaseList(newList);
    syncToStore(newList, useSceneList);
  };

  const onCaseCancel = () => {
    setCaseVisible(false);
    currentCaseRef.current = null;
  };

  const onCaseConfirm = async () => {
    try {
      const values = await caseForm.validateFields();
      const id = currentCaseRef.current?.id || generateRandomId(8);
      const existingData = useCaseList.find((item) => item.id === id);

      let newCaseList: UseCase[];
      if (existingData) {
        newCaseList = useCaseList.map((item) =>
          item.id === id
            ? { ...item, input_text: values.input_text || '', output_text: values.output_text || '' }
            : item
        );
      } else {
        newCaseList = [
          ...useCaseList,
          {
            type: 'case',
            id,
            input_text: values.input_text || '',
            output_text: values.output_text || '',
          },
        ];
      }
      setUseCaseList(newCaseList);
      syncToStore(newCaseList, useSceneList);
      onCaseCancel();
    } catch (error) {
      // Validation failed
    }
  };

  const onSceneOpen = (data?: UseCase) => {
    if (!data) {
      const filledScenes = useSceneList.filter((item) => item.id);
      if (filledScenes.length >= 3) {
        message.warning(t('agent.scene_limit_reached'));
        return;
      }
    }
    currentSceneRef.current = data || null;
    setSceneVisible(true);
  };

  const onSceneDelete = (index: number) => {
    const newList = [...useSceneList];
    newList.splice(index, 1);
    // Pad with placeholders to minimum 3 for display
    while (newList.length < 3) {
      newList.push({
        id: '',
        type: 'scene',
        image: '',
        scene: '',
        desc: '',
      });
    }
    setUseSceneList(newList);
    syncToStore(useCaseList, newList);
  };

  const onSceneCancel = () => {
    setSceneVisible(false);
    currentSceneRef.current = null;
  };

  const onSceneConfirm = async () => {
    try {
      const values = await sceneForm.validateFields();
      const id = currentSceneRef.current?.id || generateRandomId(8);
      const existingData = useSceneList.find((item) => item.id === id);

      let newSceneList: UseCase[];
      if (existingData) {
        newSceneList = useSceneList.map((item) =>
          item.id === id
            ? { ...item, image: values.image || '', scene: values.scene || '', desc: values.desc || '' }
            : item
        );
      } else {
        const emptyIndex = useSceneList.findIndex((item) => !item.id);
        if (emptyIndex >= 0) {
          newSceneList = [...useSceneList];
          newSceneList[emptyIndex] = {
            type: 'scene',
            id,
            image: values.image || '',
            scene: values.scene || '',
            desc: values.desc || '',
          };
        } else {
          newSceneList = useSceneList;
        }
      }
      setUseSceneList(newSceneList);
      syncToStore(useCaseList, newSceneList);
      onSceneCancel();
    } catch (error) {
      // Validation failed
    }
  };

  return (
    <div>
      <div className="text-sm font-medium text-[#9CA3AF] py-1.5 border-b">
        {t('agent.usage_help')}
      </div>
      <CollapsibleSection
        title={t('app.usage_scene')}
        actions={
          <Button color="default" variant="link" className="px-0" onClick={() => onSceneOpen()}>
            <SvgIcon name="plus" size={16} />
          </Button>
        }
      >
        {!useSceneList.some((item) => item.id) ? (
          <div className="text-sm text-[#9CA3AF]">
            {t('prompt.usage_scene_desc')}
          </div>
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
          <div className="text-sm text-[#9CA3AF]">
            {t('prompt.usage_case_desc')}
          </div>
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

      {/* Case Modal */}
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

      {/* Scene Modal */}
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
            getValueFromEvent={(url: string) => url}
            getValueProps={(value) => ({ value })}
          >
            <ImageUpload className="!w-[120px] !h-[112px]" />
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
  );
}

export default GuideView;