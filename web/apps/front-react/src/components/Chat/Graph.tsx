import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import { Popover, Button } from "antd";
import { CloseOutlined, ShareAltOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { GraphViewerWidget } from "@km/shared-business/chat";
import loadLib from "@/utils/loadLib";
import { getPublicPath } from "@/utils/config";
import { deepCopy } from "@/utils";

interface GraphProps {
  onView?: (info: any) => void;
  virtualRef?: React.RefObject<HTMLElement | null>;
}

export interface GraphRef {
  setLibraryInfo: (info: any, type?: string) => void;
  hide: () => void;
}

export const Graph = forwardRef<GraphRef, GraphProps>(
  ({ onView, virtualRef }, ref) => {
    const [visible, setVisible] = useState(false);
    const [libraryInfo, setLibraryInfo] = useState<any | null>(null);
    const [showGraph, setShowGraph] = useState(false);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const graphRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      setLibraryInfo: (info: any, type?: string) => {
        setLibraryInfo(deepCopy(info));
        // 设置触发元素的位置
        if (virtualRef?.current) {
          setTriggerRect(virtualRef.current.getBoundingClientRect());
        }
        // 如果有图谱数据，预先设置 showGraph
        if (info?.graph) {
          setShowGraph(true);
        }
      },
      hide: () => {
        setVisible(false);
        setTriggerRect(null);
        setShowGraph(false);
      },
    }));

    // 关闭时清理触发元素位置
    useEffect(() => {
      if (!visible) {
        setTriggerRect(null);
      }
    }, [visible]);

    const handleViewGraph = useCallback(() => {
      if (libraryInfo) {
        onView?.(libraryInfo);
      }
      setVisible(false);
    }, [libraryInfo, onView]);

    // 当 libraryInfo 变化且有 virtualRef 时自动打开
    useEffect(() => {
      if (libraryInfo && triggerRect) {
        setVisible(true);
        // 打开后设置图谱数据
        if (libraryInfo.graph) {
          setShowGraph(true);
          setTimeout(() => {
            graphRef.current?.setGraphData({
              entities: libraryInfo.graph.entities || [],
              relations: libraryInfo.graph.relations || [],
            });
          }, 100);
        }
      }
    }, [libraryInfo, triggerRect]);

    const content = libraryInfo ? (
      <div style={{ width: 680 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="size-5 rounded flex items-center justify-center bg-[#145CF7] text-white">
              <SvgIcon name="six-points" />
            </div>
            <h3 className="flex-1 text-base text-[#1D1E1F] truncate">
              知识图谱
            </h3>
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setVisible(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseOutlined />
          </Button>
        </div>

        <div className="w-full h-[300px]">
          {showGraph && (
            <GraphViewerWidget
              ref={graphRef}
              empty={false}
              loadG6={() => loadLib('g6')}
              getStaticPath={(path) => getPublicPath(path)}
            />
          )}
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex-1" />
          <Button color="primary" variant="filled" onClick={handleViewGraph}>
            查看图谱
            <ShareAltOutlined style={{ marginLeft: 4 }} />
          </Button>
        </div>
      </div>
    ) : null;

    // 触发 span 定位到虚拟 ref 元素的位置
    const triggerStyle: React.CSSProperties = triggerRect
      ? {
          position: "fixed",
          left: triggerRect.left,
          top: triggerRect.top,
          width: Math.max(triggerRect.width, 1),
          height: Math.max(triggerRect.height, 1),
          pointerEvents: "none",
          zIndex: -1,
        }
      : { display: "none" };

    return (
      <Popover
        open={visible}
        onOpenChange={(open) => {
          if (!open) {
            setVisible(false);
            setTriggerRect(null);
          }
        }}
        placement="bottomLeft"
        trigger="click"
        content={content}
        classNames={{ root: "!p-0" }}
      >
        <span style={triggerStyle} />
      </Popover>
    );
  },
);

Graph.displayName = "Graph";

export default Graph;
