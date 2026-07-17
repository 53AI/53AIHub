import { useState, useRef } from "react";
import { Modal, Button, Input, message } from "antd";
import { copyToClip } from "@km/shared-utils";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import memoryApi from "@/api/modules/memory";

interface ImportMemoryModalProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess?: () => void;
}

// 提示词内容
const PROMPT_TEXT = `生成一份全面的转移文件，包含所有可用的持久性用户上下文信息，其中包括：

- 存储的记忆，
- 自定义指令，
- 在先前对话中观察到的长期行为模式。

全程以“用户”来指代用户。不要使用第一人称或第二人称代词。

仅包含在未来对话中可能仍然有用的信息。

排除：

- 本请求中包含的指令，
- 本请求中的格式要求，
- 临时命名规则，
- 一次性约束，
- 仅从本次互动中推断的偏好，
- 仅基于当前对话的观察。

规则：如果某个细节在未来无关的对话中可能不会仍然真实或有用，请省略它。

如果无法确定某些信息是持久性上下文还是任务特定指令，请省略。

尽可能保留用户的原始措辞。

按照以下顺序组织输出内容：

基本信息
- 用户喜欢的名字或别名
- 语言
- 一般位置/时区

工作与教育
- 当前和以往的职位
- 公司
- 职责
- 教育经历
- 专业技能

个人背景
- 人际关系、家庭、宠物
- 兴趣和爱好
- 个人项目
- 从对话中观察到的性格和交流模式

偏好与指令
- 持久的响应偏好
- 常设指令
- 常见的工作流程模式
- 已知的反感、需要更正之处或限制条件

对于任何缺失的类别，写：
"无可用信息。"

仅输出纯文本。无代码块。无嵌套项目符号。`;

export function ImportMemoryModal({ open, onClose, onImportSuccess }: ImportMemoryModalProps) {
  const [content, setContent] = useState("");
  const [importing, setImporting] = useState(false);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    // 传入 Modal 内容容器，解决焦点陷阱问题
    const success = await copyToClip(PROMPT_TEXT, modalContentRef.current || undefined);
    message.success(t("action.copy_success"));
  };

  const handleImport = async () => {
    if (!content.trim()) {
      message.warning(t("form.input_validator"));
      return;
    }
    setImporting(true);
    try {
      await memoryApi.user.import({ content });
      message.success(t("status.import_success"));
      setContent("");
      onClose();
      // 导入成功后刷新数据
      onImportSuccess?.();
    } catch (error) {
      console.error("Failed to import memory:", error);
      message.error(t("status.import_failed"));
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setContent("");
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("profile.import_memory_modal_title")}
      onCancel={handleClose}
      footer={null}
      width={680}
      centered
    >
      <div className="py-2" ref={modalContentRef}>
        {/* 步骤 1 */}
        <div className="mb-4 bg-[#F7F8FA] py-3 px-4 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 flex items-center justify-center text-xs bg-white rounded-full">1</span>
              <span className="text-sm">{t("profile.import_step1_title")}</span>
            </div>
            <div
              className="h-6 rounded flex items-center justify-center cursor-pointer bg-[#eaeef8] hover:bg-[#E1E2E3] text-sm text-[#2563EB] !py-[5px] !px-2"
              onClick={handleCopy}
            >
              <SvgIcon name="copy" size="16" className="mr-1 text-[#2563EB]"></SvgIcon>
              {t("action.copy")}
            </div>
          </div>
          <div className="h-[174px] overflow-y-auto p-4 rounded-lg bg-white border border-[#E6E8EB]">
            <div className="text-sm text-[#495266] whitespace-pre-line">
              {PROMPT_TEXT}
            </div>
          </div>
        </div>

        {/* 步骤 2 */}
        <div className="mb-4 bg-[#F7F8FA] py-3 px-4 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 flex items-center justify-center text-xs bg-white rounded-full">2</span>
            <span className="text-sm">{t("profile.import_step2_title")}</span>
          </div>
          <Input.TextArea
            rows={8}
            value={content}
            style={{ resize: 'none' }}
            onChange={(e) => setContent(e.target.value)}
            className="resize-none text-sm placeholder:text-[#B0B0B0]"
          />
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-3">
          <Button onClick={handleClose}>{t("action.cancel")}</Button>
          <Button
            type="primary"
            onClick={handleImport}
            loading={importing}
            disabled={!content.trim()}
          >
            {t("action.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ImportMemoryModal;