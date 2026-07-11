import { useEffect, useRef, useState } from "react";
import { Button, Spin, message } from "antd";
import chunkSettingApi from "@/api/modules/chunk-setting";
import { useLibraryStore } from "@/stores/modules/library";
import { Header } from "@/components/Header";
import {
  ChunkConfig,
  type ChunkConfigRef,
} from "@/views/library/components/chunk/Config";

export function LibraryChunkSettingsView() {
  const libraryStore = useLibraryStore();
  const chunkConfigRef = useRef<ChunkConfigRef>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!libraryStore.library_id) return;
    const config = chunkConfigRef.current?.getChunkConfig();
    if (!config) {
      return;
    }
    setLoading(true);
    try {
      await chunkSettingApi.config.library.update(
        libraryStore.library_id,
        config,
      );
      message.success("保存成功");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadConfig = async () => {
      if (!libraryStore.library_id) return;
      setLoading(true);
      try {
        const config = await chunkSettingApi.config.library.get(
          libraryStore.library_id,
        );
        chunkConfigRef.current?.setChunkConfig(config);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, [libraryStore.library_id]);

  return (
    <div className="flex-1 h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="语料拆分" />
      <Spin spinning={loading}>
        <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
          <ChunkConfig ref={chunkConfigRef} />
          <Button type="primary" className="mt-5" onClick={handleSave}>
            保存
          </Button>
        </div>
      </Spin>
    </div>
  );
}

export default LibraryChunkSettingsView;
