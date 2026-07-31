import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Spin } from "antd";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { useSpaceStore } from "@/stores/modules/space";
import DynamicKnowledge from "./index";
import EmptyView from "./views/EmptyView";
import Footer from "@/components/Layout/Footer";

export function WikiView() {
  const isSoftStyle = useIsSoftStyle();
  const [searchParams] = useSearchParams();
  const urlSpaceId = searchParams.get("space_id") || "";

  const spaceList = useSpaceStore((state) => state.spaceList);
  const loadSpaceList = useSpaceStore((state) => state.loadSpaceList);
  const setSpaceId = useSpaceStore((state) => state.setSpaceId);

  const [activeSpaceId, setActiveSpaceId] = useState(urlSpaceId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      const list = await loadSpaceList();
      if (!mounted) return;

      let nextId = "";
      if (urlSpaceId && list.find((item) => item.id === urlSpaceId)) {
        nextId = urlSpaceId;
      } else if (list.length > 0) {
        nextId = list[0].id;
      }
      setActiveSpaceId(nextId);
      if (nextId) setSpaceId(nextId);
      if (mounted) setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [urlSpaceId, loadSpaceList, setSpaceId]);

  useEffect(() => {
    if (loading) return;
    if (urlSpaceId && urlSpaceId !== activeSpaceId) {
      if (spaceList.find((item) => item.id === urlSpaceId)) {
        setActiveSpaceId(urlSpaceId);
        setSpaceId(urlSpaceId);
      }
    }
  }, [urlSpaceId, spaceList, activeSpaceId, loading, setSpaceId]);

  const currentSpace = spaceList.find((item) => item.id === activeSpaceId);
  const dynamicEnabled = currentSpace?.enable_wiki_dynamic_knowledge;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  const content = dynamicEnabled ? (
    <div className="h-full flex flex-col">
      <DynamicKnowledge />
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center">
      <EmptyView type="dynamic" />
    </div>
  );

  if (isSoftStyle) {
    return <div className="h-full overflow-hidden">{content}</div>;
  }

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="flex-1 w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-4 md:py-6 lg:py-8 min-h-0">
        {content}
      </div>
      <Footer />
    </div>
  );
}

export default WikiView;