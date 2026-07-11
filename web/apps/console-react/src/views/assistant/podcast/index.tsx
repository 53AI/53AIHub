import { useEffect } from "react";
import { Switch } from "antd";
import { Layout } from "@/components/Layout";
import { Header } from "@/components/Header";
import { t } from "@/locales";

export default function Podcast() {
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
              <div className="flex-1 text-sm font-medium text-primary">{t('podcast.document_qa')}</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              {t('podcast.document_qa_desc')}
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="size-6"></div>
              <div className="flex-1 text-sm font-medium text-primary">{t('podcast.knowledge_extraction')}</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              {t('podcast.knowledge_extraction_desc')}
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2.5">
              <div className="size-6"></div>
              <div className="flex-1 text-sm font-medium text-primary">{t('podcast.ai_podcast')}</div>
              <Switch />
            </div>
            <p className="text-xs text-placeholder mt-3">
              {t('podcast.ai_podcast_desc')}
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
