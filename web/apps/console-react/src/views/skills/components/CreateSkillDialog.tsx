import { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Modal, Button, Form, Input, Progress, message, Tooltip } from "antd";
import { CheckOutlined, UploadOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import FileUpload from "@/components/Upload";
import { useNavigate } from "react-router-dom";
import {
  startVirtualProgress,
  type ProgressController,
} from "@/utils/progress";
import { skillApi } from "@/api/modules/skill/index";
import { t } from "@/locales";

interface CreateSkillDialogRef {
  open: () => void;
}

interface RepoFormData {
  url: string;
}

interface UploadFormData {
  file: File[];
}

interface UploadedFile {
  name: string;
  id?: string;
}

interface TypeOption {
  value: "repo" | "upload" | "chat";
  label: string;
  description: string;
  icon: string | React.ComponentType;
  iconType: "svg" | "el";
  iconColor: string;
  disabled?: boolean;
  tooltip?: string;
}

const getTypeOptions = (): TypeOption[] => [
  {
    value: "repo",
    label: t("skills.create.type_repo"),
    description: t("skills.create.type_repo_desc"),
    icon: "github",
    iconType: "svg",
    iconColor: "bg-blue-500",
  },
  {
    value: "upload",
    label: t("skills.create.type_upload"),
    description: t("skills.create.type_upload_desc"),
    icon: "upload",
    iconType: "svg",
    iconColor: "bg-purple-500",
  },
  {
    value: "chat",
    label: t("skills.create.type_chat"),
    description: t("skills.create.type_chat_desc"),
    icon: "chat_v2",
    iconType: "svg",
    iconColor: "bg-blue-400",
    disabled: true,
    tooltip: t("skills.create.type_chat_tooltip"),
  },
];

const CreateSkillDialog = forwardRef<CreateSkillDialogRef>((props, ref) => {
  const navigate = useNavigate();
  const [dialogVisible, setDialogVisible] = useState(false);
  const [securityDialogVisible, setSecurityDialogVisible] = useState(false);
  const [loadingDialogVisible, setLoadingDialogVisible] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [addType, setAddType] = useState<"repo" | "upload" | "chat">("repo");
  const [scanStatusText, setScanStatusText] = useState("");
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [repoForm] = Form.useForm<RepoFormData>();
  const uploadRef = useRef<any>(null);
  const [uploadForm, setUploadForm] = useState<UploadFormData>({ file: [] });
  const [uploadedFile, setUploadedFile] = useState<UploadedFile>({ name: "" });

  const typeOptions = getTypeOptions();

  useImperativeHandle(ref, () => ({
    open: () => {
      setDialogVisible(true);
    },
  }));

  const handleClose = () => {
    setDialogVisible(false);
    resetForms();
  };

  const resetForms = () => {
    setAddType("repo");
    repoForm.resetFields();
    setUploadForm({ file: [] });
    setUploadedFile({ name: "", id: undefined });
    uploadRef.current?.clearFiles?.();
  };

  const handleFileBefore = (file: File) => {
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      message.error(t("skills.create.file_size_limit"));
      uploadRef.current?.clearFiles?.();
      return false;
    }
    if (!file.name.endsWith(".zip")) {
      message.error(t("skills.create.only_zip"));
      uploadRef.current?.clearFiles?.();
      return false;
    }
    return true;
  };

  const handleFileSuccess = (data: any) => {
    if (data) {
      setUploadedFile({
        name: data.name,
        id: data.id,
      });
      message.success(t("skills.create.upload_success"));
    }
  };

  const handleFileError = () => {
    message.error(t("skills.create.upload_failed"));
    setUploadedFile({ name: "", id: undefined });
  };

  const handleRemoveFile = () => {
    setUploadedFile({ name: "", id: undefined });
    uploadRef.current?.clearFiles?.();
    setUploadForm({ file: [] });
  };

  const submitSkill = (): Promise<{ skill_id: string }> => {
    return new Promise((resolve, reject) => {
      let fetchController: ProgressController | null = null;
      let scanController: ProgressController | null = null;
      let pollingTimer: ReturnType<typeof setTimeout> | null = null;

      setScanStatusText(
        addType === "repo" ? t("skills.create.connecting_repo") : t("skills.create.extracting_file"),
      );
      fetchController = startVirtualProgress({
        startPercent: 0,
        endPercent: 50,
        baseInterval: 80,
        onProgress: (p) => setLoadingPercentage(p),
      });

      const requestData =
        addType === "repo"
          ? {
              source_type: "github" as const,
              github_url: repoForm.getFieldValue("url"),
            }
          : {
              source_type: "zip" as const,
              upload_file_id: uploadedFile.id,
            };

      skillApi
        .import(requestData)
        .then((result: any) => {
          const jobId = result?.scan_job_id;
          if (!jobId) {
            throw new Error(t("skills.create.no_scan_job_id"));
          }
          // 保存 scan_job_id 以便后续强制导入使用
          setScanJobId(jobId);

          fetchController?.stop();
          scanController = startVirtualProgress({
            startPercent: 50,
            endPercent: 90,
            baseInterval: 150,
            onProgress: (p) => setLoadingPercentage(p),
          });

          const pollScanStatus = () => {
            skillApi
              .getImportJob({ id: jobId })
              .then((detailResult: any) => {
                const scanJob = detailResult?.job;
                const status = scanJob?.status;
                const skillId = detailResult?.skill?.id;

                if (status === "pending") {
                  pollingTimer = setTimeout(pollScanStatus, 5000);
                } else if (status === "running") {
                  pollingTimer = setTimeout(pollScanStatus, 5000);
                } else if (status === "success") {
                  const riskLevel = scanJob?.risk_level;
                  if (riskLevel === "high") {
                    scanController?.stop();
                    if (pollingTimer) clearTimeout(pollingTimer);
                    reject({ code: "SECURITY_RISK", message: t("skills.create.security_risk_high") });
                    return;
                  }

                  scanController?.stop();
                  if (pollingTimer) clearTimeout(pollingTimer);

                  const completeTimer = setInterval(() => {
                    setLoadingPercentage((prev) => {
                      if (prev >= 100) {
                        clearInterval(completeTimer);
                        resolve({ skill_id: skillId });
                        return 100;
                      }
                      return Math.min(100, prev + 5);
                    });
                  }, 30);
                } else if (status === "failed") {
                  const riskLevel = scanJob?.risk_level;

                  if (
                    riskLevel === "high" ||
                    scanJob?.message?.includes("skill scan risk is too high")
                  ) {
                    scanController?.stop();
                    if (pollingTimer) clearTimeout(pollingTimer);
                    reject({ code: "SECURITY_RISK", message: t("skills.create.security_risk_high") });
                    return;
                  }

                  scanController?.stop();
                  if (pollingTimer) clearTimeout(pollingTimer);

                  const errorMsg = scanJob?.message || t("skills.create.scan_failed");
                  reject({ code: "SCAN_FAILED", message: errorMsg });
                } else {
                  pollingTimer = setTimeout(pollScanStatus, 5000);
                }
              })
              .catch(() => {
                scanController?.stop();
                if (pollingTimer) clearTimeout(pollingTimer);
                reject({ code: "POLL_ERROR", message: t("skills.create.poll_status_failed") });
              });
          };

          pollScanStatus();
        })
        .catch((error: any) => {
          fetchController?.stop();
          scanController?.stop();
          if (pollingTimer) clearTimeout(pollingTimer);

          const errorCode = error?.response?.data?.code;
          reject({ code: errorCode, message: t("skills.create.import_failed") });
        });
    });
  };

  const handleConfirm = async () => {
    if (addType === "repo") {
      try {
        await repoForm.validateFields();
      } catch {
        return;
      }
    } else if (addType === "upload") {
      if (!uploadedFile.name) {
        message.warning(t("skills.create.select_file"));
        return;
      }
    }

    setLoadingDialogVisible(true);
    setLoadingPercentage(0);
    try {
      const result = await submitSkill();
      setLoadingDialogVisible(false);
      setDialogVisible(false);
      navigate({
        pathname: "/skills/create",
        search: `?skill_id=${result.skill_id}&isNew=true`,
      });
    } catch (error: any) {
      setLoadingDialogVisible(false);
      if (error?.code === "SECURITY_RISK") {
        setSecurityDialogVisible(true);
      } else if (
        error?.message === "db error: work ai model is not configured"
      ) {
        message.error(t("skills.create.model_not_configured"));
      } else if (error?.message?.includes("skill package missing SKILL.md")) {
        message.error(t("skills.create.missing_skill_md"));
      } else if (error?.message?.includes("skill name already exists")) {
        message.error(t("skills.create.skill_exists"));
      } else {
        message.error(error?.message);
      }
    }
  };

  const handleSecurityCancel = () => {
    setSecurityDialogVisible(false);
    setScanJobId(null);
  };

  // 强制导入
  const handleSecurityForceImport = async () => {
    if (!scanJobId) {
      message.error(t("skills.create.no_scan_job_id"));
      return;
    }

    try {
      const result: any = await skillApi.forceImport({ scan_job_id: scanJobId });
      const scanStatus = result?.scan_status;
      const skillId = result?.skill_id;
      if (scanStatus !== "success") {
        throw new Error(result?.message || t("skills.create.force_import_failed"));
      }
      setDialogVisible(false);
      setScanJobId(null);
      navigate({
        pathname: "/skills/create",
        search: `?skill_id=${skillId}&isNew=true`,
      });
    } catch (error: any) {
      message.error(error?.message || t("skills.create.force_import_failed"));
    } finally {
      setSecurityDialogVisible(false);
    }
  };

  const renderTypeIcon = (option: TypeOption) => {
    if (option.iconType === "svg") {
      return <SvgIcon name={option.icon as string} color="#fff" size={20} />;
    }
    const IconComponent = option.icon as React.ComponentType;
    return <IconComponent />;
  };

  return (
    <>
      {/* 添加技能对话框 */}
      <Modal
        open={dialogVisible}
        title={t("skills.action_add")}
        width="60%"
        mask={{ closable: false }}
        onCancel={handleClose}
        footer={
          <div className="flex justify-end gap-3">
            <Button onClick={handleClose}>{t("action_cancel")}</Button>
            <Button type="primary" onClick={handleConfirm}>
              {t("action_confirm")}
            </Button>
          </div>
        }
      >
        {/* 类型选择 */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-4">
            {t("skills.create.type")}
          </label>
          <div className="flex gap-4">
            {typeOptions.map((option) => (
              <Tooltip
                key={option.value}
                title={option.disabled ? option.tooltip : ""}
              >
                <div
                  className={`flex items-start gap-4 p-3 rounded-lg border-2 transition-all duration-200 ${
                    option.disabled
                      ? "opacity-50 cursor-not-allowed bg-gray-50/50"
                      : "cursor-pointer hover:border-blue-200"
                  } ${
                    addType === option.value && !option.disabled
                      ? "border-blue-500 hover:border-blue-500 bg-blue-50/30"
                      : "border-gray-100"
                  }`}
                  onClick={() => !option.disabled && setAddType(option.value)}
                >
                  <div
                    className={`size-9 rounded-lg flex items-center justify-center text-white flex-shrink-0 ${option.iconColor}`}
                  >
                    {renderTypeIcon(option)}
                  </div>
                  <div>
                    <div
                      className={`text-sm font-semibold text-gray-900 mb-1 ${
                        addType === option.value && !option.disabled
                          ? "!text-blue-600"
                          : ""
                      }`}
                    >
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      {option.description}
                    </div>
                  </div>
                </div>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* 仓库URL表单 */}
        {addType === "repo" && (
          <div className="space-y-6 mb-4">
            <Form form={repoForm} layout="vertical">
              <Form.Item
                label={t("skills.create.github_repo_url")}
                name="url"
                rules={[
                  {
                    validator: (_, value) => {
                      if (!value) {
                        return Promise.reject(new Error(t("skills.create.github_url_required")));
                      }
                      if (!value.includes("github.com")) {
                        return Promise.reject(
                          new Error(t("skills.create.github_url_invalid")),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input
                  placeholder={t("skills.create.github_url_placeholder")}
                  maxLength={200}
                  showCount
                />
              </Form.Item>
            </Form>
          </div>
        )}

        {/* 上传技能表单 */}
        {addType === "upload" && (
          <div>
            {uploadedFile.name ? (
              <div className="mt-3 py-[10px] px-2 rounded-lg border border-blue-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckOutlined className="text-green-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {uploadedFile.name}
                  </span>
                </div>
                <SvgIcon
                  name="delete"
                  className="text-red-500 cursor-pointer"
                  onClick={handleRemoveFile}
                />
              </div>
            ) : (
              <FileUpload
                ref={uploadRef}
                className="w-full"
                full
                drag
                limit={1}
                accept=".zip"
                size={10}
                beforeUpload={handleFileBefore}
                onSuccess={handleFileSuccess}
                onError={handleFileError}
              >
                <div className="w-full flex flex-col items-center justify-center p-8 bg-[rgba(249,250,251,0.3)] rounded-xl border-2 border-dashed border-gray-200 transition-all hover:bg-[rgba(239,246,255,0.2)] hover:border-blue-500">
                  <UploadOutlined
                    className="text-blue-500 mb-4"
                    style={{ fontSize: 48 }}
                  />
                  <div className="text-base font-medium text-gray-900">
                    {t("skills.create.drag_or_click")}
                  </div>
                  <div className="text-sm text-gray-400 mt-2">
                    {t("skills.create.zip_file_limit")}
                  </div>
                </div>
              </FileUpload>
            )}
          </div>
        )}
      </Modal>

      {/* 加载中弹窗 */}
      <Modal
        open={loadingDialogVisible}
        width={360}
        closable={false}
        mask={{ closable: false }}
        footer={null}
      >
        <div className="flex flex-col items-center py-8">
          <Progress
            type="circle"
            percent={loadingPercentage}
            strokeWidth={6}
            size={100}
            strokeColor="#2563EB"
            className="mb-6"
          />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {addType === "repo" ? t("skills.create.pulling_and_scanning") : t("skills.create.extracting_and_scanning")}
          </h3>
          <p className="text-sm text-blue-300">{scanStatusText}</p>
        </div>
      </Modal>

      {/* 安全风险拦截弹窗 */}
      <Modal
        open={securityDialogVisible}
        width={420}
        closable={false}
        mask={{ closable: false }}
        footer={null}
      >
        <div className="flex flex-col items-center pt-4 pb-1">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <SvgIcon name="warning" size="32px" color="#EF4444" />
          </div>
          <h3 className="text-lg font-medium text-primary mb-4">
            {t("skills.create.security_risk_blocked")}
          </h3>
          <div className="w-full bg-red-50 rounded-lg p-4 mb-9">
            <p className="text-sm text-[#E3050C] text-center mb-2">
              {t("skills.create.security_risk_high")}
            </p>
            <p className="text-tag-red text-xs text-center leading-relaxed">
              {t("skills.create.security_risk_detail")}
            </p>
          </div>
          <Button type="primary" className="w-full mb-3" onClick={handleSecurityCancel}>
            {t("skills.create.dont_install")}
          </Button>
          <Button className="w-full" onClick={handleSecurityForceImport}>
            {t("skills.create.install_anyway")}
          </Button>
        </div>
      </Modal>
    </>
  );
});

CreateSkillDialog.displayName = "CreateSkillDialog";

export default CreateSkillDialog;
