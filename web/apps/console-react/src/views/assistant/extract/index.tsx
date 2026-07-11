import { useEffect } from "react";
import { Switch } from "antd";
import { Layout } from "@/components/Layout";
import { Header } from "@/components/Header";
import { t } from "@/locales";

export default function Extract() {
  useEffect(() => {
    // onMounted equivalent
  }, []);

  return (
    <Layout className="px-[60px] py-8">
      <Header title={t("module.document_app")} />
      <div className="flex-1 flex flex-col bg-white p-6 mt-3 box-border max-h-[calc(100vh-100px)] overflow-auto">
        <div className="grid grid-cols-3 gap-6">
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="size-6"></div>
              <div className="flex-1 text-sm font-medium text-primary">文档问答</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              多领域知识问答助手，可快速响应各类问题，提供精准、多维度的知识解答，高效获取信息。
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="size-6"></div>
              <div className="flex-1 text-sm font-medium text-primary">知识萃取</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              专注于合同文本的智能审阅工具，能识别合同条款风险、审查合规性、优化表述，提供专业且高效的支持。
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="size-6"></div>
              <div className="flex-1 text-sm font-medium text-primary">AI播客</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              基于多领域知识的智能播客生成助手，可快速创作主题丰富、内容专业的播客内容，满足文档收听的需求。
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
