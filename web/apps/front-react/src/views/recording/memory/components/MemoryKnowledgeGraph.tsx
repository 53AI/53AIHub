import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { GraphViewerWidget } from '@/views/library/main/file/chunks/components/GraphViewerWidget';
import type { GraphViewerWidgetRef } from '@/views/library/main/file/chunks/components/GraphViewerWidget';

// GraphViewerWidget 内部使用了 GraphData / EntityItem / RelationItem 类型但没有 export，
// 这里按其结构内联定义，避免去原文件改动导出（保持边界最小）。
interface MemoryGraphEntity {
  id: string;
  name: string;
  type?: string;
}

interface MemoryGraphRelation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate?: string;
}

type MemoryGraphData = {
  entities?: MemoryGraphEntity[];
  relations?: MemoryGraphRelation[];
};

// 知识图谱视图（mock 版）。
// 复用 library/chunks/components/GraphViewerWidget（G6 力导向图 + 缩放/搜索/适配）。
// 等待后端补全图 endpoint 后,把 setGraphData 的数据源切到真实接口即可。
const MOCK_GRAPH_DATA: MemoryGraphData = {
  entities: [
    // 人物
    { id: 'p1', name: '张智伟', type: '人物' },
    { id: 'p2', name: '王晓明', type: '人物' },
    { id: 'p3', name: '李华', type: '人物' },
    { id: 'p4', name: '刘芳', type: '人物' },
    { id: 'p5', name: '陈静', type: '人物' },
    { id: 'p6', name: '赵磊', type: '人物' },
    { id: 'p7', name: '孙浩', type: '人物' },
    { id: 'p8', name: '周丽', type: '人物' },
    // 事项
    { id: 'm1', name: 'Q3 产品迭代', type: '事项' },
    { id: 'm2', name: '客户满意度调研', type: '事项' },
    { id: 'm3', name: '年度战略会议', type: '事项' },
    { id: 'm4', name: '渠道拓展计划', type: '事项' },
    { id: 'm5', name: '季度营收复盘', type: '事项' },
    // 风险
    { id: 'r1', name: '数据安全合规风险', type: '风险' },
    { id: 'r2', name: '核心人才流失风险', type: '风险' },
    { id: 'r3', name: '供应链中断风险', type: '风险' },
    // 原则
    { id: 'pr1', name: '用户优先', type: '原则' },
    { id: 'pr2', name: '数据驱动', type: '原则' },
    { id: 'pr3', name: '风险可控', type: '原则' },
    { id: 'pr4', name: '成本意识', type: '原则' },
  ],
  relations: [
    { id: 'rel1', source_entity_id: 'p1', target_entity_id: 'm1', predicate: '负责' },
    { id: 'rel2', source_entity_id: 'p1', target_entity_id: 'pr1', predicate: '推动' },
    { id: 'rel3', source_entity_id: 'p1', target_entity_id: 'm3', predicate: '主持' },
    { id: 'rel4', source_entity_id: 'p2', target_entity_id: 'm1', predicate: '主导' },
    { id: 'rel5', source_entity_id: 'p2', target_entity_id: 'pr2', predicate: '推动' },
    { id: 'rel6', source_entity_id: 'p3', target_entity_id: 'm2', predicate: '主导' },
    { id: 'rel7', source_entity_id: 'p4', target_entity_id: 'p1', predicate: '汇报' },
    { id: 'rel8', source_entity_id: 'p4', target_entity_id: 'r2', predicate: '关注' },
    { id: 'rel9', source_entity_id: 'p5', target_entity_id: 'r1', predicate: '预警' },
    { id: 'rel10', source_entity_id: 'p5', target_entity_id: 'pr3', predicate: '推动' },
    { id: 'rel11', source_entity_id: 'p6', target_entity_id: 'm4', predicate: '协调' },
    { id: 'rel12', source_entity_id: 'p7', target_entity_id: 'm5', predicate: '复盘' },
    { id: 'rel13', source_entity_id: 'p8', target_entity_id: 'r3', predicate: '关注' },
    { id: 'rel14', source_entity_id: 'p8', target_entity_id: 'pr4', predicate: '倡导' },
    { id: 'rel15', source_entity_id: 'r1', target_entity_id: 'm1', predicate: '影响' },
    { id: 'rel16', source_entity_id: 'r2', target_entity_id: 'm4', predicate: '影响' },
    { id: 'rel17', source_entity_id: 'r3', target_entity_id: 'm5', predicate: '影响' },
    { id: 'rel18', source_entity_id: 'pr1', target_entity_id: 'm1', predicate: '指导' },
    { id: 'rel19', source_entity_id: 'pr2', target_entity_id: 'm2', predicate: '指导' },
    { id: 'rel20', source_entity_id: 'pr3', target_entity_id: 'm4', predicate: '指导' },
    { id: 'rel21', source_entity_id: 'pr4', target_entity_id: 'm5', predicate: '指导' },
    { id: 'rel22', source_entity_id: 'm1', target_entity_id: 'm2', predicate: '关联' },
  ],
};

export interface MemoryKnowledgeGraphRef {
  fitView: () => void;
}

export const MemoryKnowledgeGraph = forwardRef<MemoryKnowledgeGraphRef>((_, ref) => {
  const widgetRef = useRef<GraphViewerWidgetRef>(null);
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<MemoryGraphData>(MOCK_GRAPH_DATA);

  useEffect(() => {
    widgetRef.current?.setGraphData(data);
  }, [data]);

  useImperativeHandle(ref, () => ({
    fitView: () => widgetRef.current?.fitView(),
  }));

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm h-[640px]">
      <GraphViewerWidget
        ref={widgetRef}
        keyword={keyword}
        isSupportSearch
        empty={(data.entities?.length ?? 0) === 0}
        emptyTitle="暂无知识图谱数据"
        emptyDescription="请等待后端补全图谱接口"
        onKeywordChange={setKeyword}
      />
    </div>
  );
});

MemoryKnowledgeGraph.displayName = 'MemoryKnowledgeGraph';

export default MemoryKnowledgeGraph;