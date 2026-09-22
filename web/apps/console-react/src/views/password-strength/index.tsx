import React, { useEffect, useState } from "react";
import {
  Form,
  Radio,
  Switch,
  InputNumber,
  Button,
  Tag,
  Divider,
  message,
  Modal,
  Space,
  Spin,
} from "antd";
import {
  CheckOutlined,
  CheckCircleFilled,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { t } from "@/locales";
import { settingApi } from "@/api/modules/setting";
type PasswordStrengthLevel = "strong" | "medium" | "weak";
type ExpirePeriod = "30" | "60" | "90" | "180" | "custom";

interface PasswordSecurityConfig {
  strength: PasswordStrengthLevel;
  expire_enabled: boolean;
  expire_period: ExpirePeriod;
  custom_expire_days: number;
  force_change_on_expired: boolean;
  brute_force_enabled: boolean;
  lock_after_failures: number;
  lock_duration_minutes: number;
  first_login_change_required: boolean;
}
// 未配置时的回退配置（弱密码，所有额外防护开关关闭，兼容老企业历史行为）
const UNCONFIGURED_CONFIG: PasswordSecurityConfig = {
  strength: "weak",
  expire_enabled: false,
  expire_period: "90",
  custom_expire_days: 90,
  force_change_on_expired: false,
  brute_force_enabled: false,
  lock_after_failures: 3,
  lock_duration_minutes: 15,
  first_login_change_required: false,
};

// 恢复默认配置（等保三级推荐标准：强密码，安全策略全开）
const RECOMMENDED_DEFAULT_CONFIG: PasswordSecurityConfig = {
  strength: "strong",
  expire_enabled: true,
  expire_period: "90",
  custom_expire_days: 90,
  force_change_on_expired: true,
  brute_force_enabled: true,
  lock_after_failures: 3,
  lock_duration_minutes: 15,
  first_login_change_required: true,
};

const SETTING_KEY = "password_security_policy";


// 请求去重：防止 React StrictMode 开发模式或快速切换导致重复调用 API
let inFlightSettingPromise: Promise<any> | null = null;
const fetchSettingPolicy = () => {
  if (inFlightSettingPromise) {
    return inFlightSettingPromise;
  }
  inFlightSettingPromise = settingApi.get(SETTING_KEY).finally(() => {
    inFlightSettingPromise = null;
  });
  return inFlightSettingPromise;
};
export function PasswordStrengthPage() {
  const [config, setConfig] = useState<PasswordSecurityConfig>({
    ...UNCONFIGURED_CONFIG,
  });
  const [settingId, setSettingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 密码强度文案映射
  const STRENGTH_DESC_MAP: Record<PasswordStrengthLevel, string> = {
    strong:
      "强：要求密码长度至少10位，必须同时包含大写字母、小写字母、数字及特殊符号组合，开启常见弱口令与历史密码重复校验。符合国家信息系统安全等级保护三级要求。",
    medium:
      "中：要求密码长度至少8位，包含大写字母、小写字母、数字、特殊符号中的任意三种组合。",
    weak: "弱：允许使用较简单的密码，兼容历史系统或测试环境，建议仅在可信内部网络中使用。",
  };

  // 首次挂载获取已有配置，未配置时使用前端默认值兜底
  useEffect(() => {
    let active = true;
    const fetchSetting = async () => {
      setLoading(true);
      try {
        const res: any = await fetchSettingPolicy();
        if (active) {
          if (res && res.data && res.data.value) {
            setSettingId(res.data.setting_id);
            try {
              const parsed = JSON.parse(res.data.value);
              setConfig((prev) => ({ ...UNCONFIGURED_CONFIG, ...parsed }));
            } catch (e) {
              console.error("Failed to parse password_security_policy setting:", e);
            }
          } else {
            // 未设置过的企业：默认展示弱密码，安全策略均关闭
            setConfig({ ...UNCONFIGURED_CONFIG });
          }
        }
      } catch (err) {
        console.error("Failed to load password security policy:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchSetting();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    // 输入合法性防御
    if (
      config.expire_period === "custom" &&
      (!config.custom_expire_days || config.custom_expire_days < 1)
    ) {
      message.warning("自定义更换周期必须大于等于 1 天");
      return;
    }
    if (config.brute_force_enabled) {
      if (!config.lock_after_failures || config.lock_after_failures < 1) {
        message.warning("连续输错次数必须大于等于 1 次");
        return;
      }
      if (!config.lock_duration_minutes || config.lock_duration_minutes < 1) {
        message.warning("锁定时间必须大于等于 1 分钟");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        key: SETTING_KEY,
        value: JSON.stringify(config),
      };

      let sid = settingId;
      if (!sid) {
        try {
          const checkRes: any = await settingApi.get(SETTING_KEY);
          if (checkRes?.data?.setting_id) {
            sid = checkRes.data.setting_id;
            setSettingId(sid);
          }
        } catch (e) {
          // ignore check error
        }
      }

      if (sid) {
        await settingApi.update(sid, payload);
      } else {
        const res: any = await settingApi.create(payload);
        if (res?.data?.setting_id) {
          setSettingId(res.data.setting_id);
        }
      }
      message.success(t("action.save_success") || "保存设置成功");
    } catch (err) {
      console.error("Failed to save password security policy:", err);
      message.error("保存设置失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = () => {
    Modal.confirm({
      title: "恢复默认配置",
      icon: <ExclamationCircleOutlined />,
      content:
        "确定要将密码强度与账号安全策略重置为系统推荐的默认配置（强密码及开启全部安全防护）吗？点击“保存设置”后正式生效。",
      okText: t("action.confirm") || "确定",
      cancelText: t("action.cancel") || "取消",
      onOk: () => {
        setConfig({ ...RECOMMENDED_DEFAULT_CONFIG });
        message.info("已重置为系统推荐配置（强密码及开启防护），点击“保存设置”后生效");
      },
    });
  };
  return (
    <div className="h-full flex flex-col bg-white px-2 box-border">
      <Spin spinning={loading}>
      <div className="flex-1 overflow-y-auto max-w-4xl py-2">
        <Form layout="vertical">
          {/* 一、密码强度 */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-semibold text-base text-primary m-0">
                密码强度
              </h2>
            </div>
            <div className="text-secondary text-xs mb-4">
              设置全员密码复杂度规则，规范密码最小长度与字符组合类型
            </div>

            <div className="grid grid-cols-3 gap-4 max-w-2xl">
              {/* 强（推荐） */}
              <div
                onClick={() =>
                  setConfig((prev) => ({ ...prev, strength: "strong" }))
                }
                className={`relative border rounded-lg p-3.5 cursor-pointer transition-all flex items-center justify-between select-none ${
                  config.strength === "strong"
                    ? "border-[#3664EF] bg-[#F5F8FF] ring-1 ring-[#3664EF]"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-primary">
                    强（推荐）
                  </span>
                  <Tag className="!border-none !bg-[#E3F6E0] !text-[#09BB07] !text-xs !px-1.5 !py-0 !m-0 inline-flex items-center gap-1 font-normal">
                    <CheckCircleFilled className="text-xs text-[#09BB07]" /> 等保三级
                  </Tag>
                </div>
                {config.strength === "strong" && (
                  <CheckOutlined className="text-[#3664EF] font-bold" />
                )}
              </div>

              {/* 中 */}
              <div
                onClick={() =>
                  setConfig((prev) => ({ ...prev, strength: "medium" }))
                }
                className={`relative border rounded-lg p-3.5 cursor-pointer transition-all flex items-center justify-between select-none ${
                  config.strength === "medium"
                    ? "border-[#3664EF] bg-[#F5F8FF] ring-1 ring-[#3664EF]"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <span className="font-medium text-sm text-primary">中</span>
                {config.strength === "medium" && (
                  <CheckOutlined className="text-[#3664EF] font-bold" />
                )}
              </div>

              {/* 弱 */}
              <div
                onClick={() =>
                  setConfig((prev) => ({ ...prev, strength: "weak" }))
                }
                className={`relative border rounded-lg p-3.5 cursor-pointer transition-all flex items-center justify-between select-none ${
                  config.strength === "weak"
                    ? "border-[#3664EF] bg-[#F5F8FF] ring-1 ring-[#3664EF]"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <span className="font-medium text-sm text-primary">弱</span>
                {config.strength === "weak" && (
                  <CheckOutlined className="text-[#3664EF] font-bold" />
                )}
              </div>
            </div>

            {/* 选中强度的说明文案 */}
            <div className="mt-3 p-3 bg-[#F8F9FB] rounded border border-gray-100 max-w-2xl">
              <div className="text-secondary text-xs leading-relaxed">
                {STRENGTH_DESC_MAP[config.strength]}
              </div>
            </div>
          </section>

          <Divider style={{ margin: "20px 0" }} />

          {/* 二、定期更换提醒 */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-semibold text-base text-primary m-0">
                定期更换提醒
              </h2>
            </div>
            <div className="text-secondary text-xs mb-4">
              设置密码使用周期与到期策略，督促用户定期更新密码
            </div>

            <div className="p-4 border rounded-lg bg-[#FAFAFA] max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-primary font-medium">
                  启用定期更换提醒
                </span>
                <Switch
                  checked={config.expire_enabled}
                  onChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      expire_enabled: checked,
                    }))
                  }
                />
              </div>

              {config.expire_enabled ? (
                <div className="space-y-4 pt-1">
                  {/* 更换周期选项 */}
                  <div>
                    <div className="text-xs text-primary font-medium mb-2">
                      更换周期选项
                    </div>
                    <Radio.Group
                      value={config.expire_period}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          expire_period: e.target.value,
                        }))
                      }
                      className="flex items-center flex-wrap gap-4"
                    >
                      <Radio value="30">30 天</Radio>
                      <Radio value="60">60 天</Radio>
                      <Radio value="90">90 天</Radio>
                      <Radio value="180">180 天</Radio>
                      <Radio value="custom">
                        <span className="inline-flex items-center gap-1.5">
                          自定义
                          <InputNumber
                            min={1}
                            max={365}
                            disabled={config.expire_period !== "custom"}
                            value={config.custom_expire_days}
                            onChange={(val) =>
                              setConfig((prev) => ({
                                ...prev,
                                custom_expire_days: val || 90,
                              }))
                            }
                            size="small"
                            className="w-20 mx-1"
                          />
                          天
                        </span>
                      </Radio>
                    </Radio.Group>
                    <div className="text-secondary text-xs mt-1.5">
                      开启后，系统将在密码到期前向用户发送通知，提醒用户及时更新密码以降低泄露风险。
                    </div>
                  </div>

                  {/* 到期处置 */}
                  <div className="pt-2 border-t border-gray-200">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-primary font-medium">
                        强制修改密码
                      </span>
                      <Switch
                        size="small"
                        checked={config.force_change_on_expired}
                        onChange={(checked) =>
                          setConfig((prev) => ({
                            ...prev,
                            force_change_on_expired: checked,
                          }))
                        }
                      />
                    </div>
                    <div className="text-secondary text-xs mt-1">
                      密码到期后，用户再次登录系统时必须修改密码后方可正常登录和使用功能。
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-secondary text-xs">
                  未开启定期更换提醒，用户密码长期有效且不设到期强制改密限制。
                </div>
              )}
            </div>
          </section>

          <Divider style={{ margin: "20px 0" }} />

          {/* 三、防暴力破解 */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-semibold text-base text-primary m-0">
                防暴力破解
              </h2>
            </div>
            <div className="text-secondary text-xs mb-4">
              限制密码错误重试频率，防止恶意自动化撞库与暴力猜测
            </div>

            <div className="p-4 border rounded-lg bg-[#FAFAFA] max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-primary font-medium">
                  启用防暴力破解限制
                </span>
                <Switch
                  checked={config.brute_force_enabled}
                  onChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      brute_force_enabled: checked,
                    }))
                  }
                />
              </div>

              <div
                className={`flex items-center flex-wrap gap-2 text-sm transition-opacity ${
                  config.brute_force_enabled
                    ? "text-primary opacity-100"
                    : "text-secondary opacity-50 pointer-events-none"
                }`}
              >
                <span>连续输错</span>
                <InputNumber
                  min={1}
                  max={20}
                  size="small"
                  className="w-16"
                  disabled={!config.brute_force_enabled}
                  value={config.lock_after_failures}
                  onChange={(val) =>
                    setConfig((prev) => ({
                      ...prev,
                      lock_after_failures: val || 3,
                    }))
                  }
                />
                <span>次密码将自动锁定账号</span>
                <InputNumber
                  min={1}
                  max={1440}
                  size="small"
                  className="w-20"
                  disabled={!config.brute_force_enabled}
                  value={config.lock_duration_minutes}
                  onChange={(val) =>
                    setConfig((prev) => ({
                      ...prev,
                      lock_duration_minutes: val || 15,
                    }))
                  }
                />
                <span>分钟，有效防御撞库与字典爆破攻击</span>
              </div>
            </div>
          </section>

          <Divider style={{ margin: "20px 0" }} />

          {/* 四、首次登录改密 */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-semibold text-base text-primary m-0">
                首次登录改密
              </h2>
            </div>

            <div className="p-4 border rounded-lg bg-[#FAFAFA] max-w-2xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-primary font-medium">
                  强制首次登录修改密码
                </span>
                <Switch
                  checked={config.first_login_change_required}
                  onChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      first_login_change_required: checked,
                    }))
                  }
                />
              </div>
              <div className="text-secondary text-xs leading-relaxed">
                开启后，管理员在后台批量导入、手动创建或重置密码的用户，首次登录系统必须修改初始默认密码。
              </div>
            </div>
          </section>
        </Form>
      </div>
      </Spin>

      {/* 底部操作栏 */}
      <Divider style={{ margin: "12px 0" }} />
      <div className="py-2 flex items-center gap-3">
        <Button type="primary" loading={saving} onClick={handleSave}>
          保存设置
        </Button>
        <Button onClick={handleResetDefault}>恢复默认配置</Button>
      </div>
    </div>
  );
}

export default PasswordStrengthPage;
