import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Empty, Spin, message, Select, Drawer } from 'antd'
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons'
import { Search } from '@km/shared-components-react'
import './GraphView.css'

interface GraphNode {
  id: string
  label: string
  type: 'entity' | 'concept' | 'document'
  size: number
  x: number
  y: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function LibraryGraphView() {
  const { id } = useParams<{ id: string }>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [searchText, setSearchText] = useState('')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    loadGraphData()
  }, [id])

  useEffect(() => {
    if (graphData && canvasRef.current) {
      drawGraph()
    }
  }, [graphData, zoom, offset, selectedNode])

  const loadGraphData = async () => {
    setLoading(true)
    try {
      // Simulated API call
      await new Promise(resolve => setTimeout(resolve, 1000))
      const data: GraphData = {
        nodes: [
          { id: '1', label: '知识管理', type: 'concept', size: 40, x: 400, y: 300 },
          { id: '2', label: '文档检索', type: 'entity', size: 30, x: 250, y: 200 },
          { id: '3', label: '智能问答', type: 'entity', size: 30, x: 550, y: 200 },
          { id: '4', label: '知识图谱', type: 'entity', size: 30, x: 300, y: 400 },
          { id: '5', label: '文档管理.md', type: 'document', size: 25, x: 150, y: 350 },
          { id: '6', label: '检索方法.md', type: 'document', size: 25, x: 600, y: 350 },
        ],
        edges: [
          { id: 'e1', source: '1', target: '2', label: '包含' },
          { id: 'e2', source: '1', target: '3', label: '包含' },
          { id: 'e3', source: '1', target: '4', label: '包含' },
          { id: 'e4', source: '2', target: '5', label: '来源' },
          { id: 'e5', source: '3', target: '6', label: '来源' },
        ],
      }
      setGraphData(data)
    } catch (error) {
      message.error('加载图谱失败')
    } finally {
      setLoading(false)
    }
  }

  const drawGraph = () => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !graphData) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = container.clientWidth
    canvas.height = container.clientHeight

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Apply transformations
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)

    // Draw edges
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    graphData.edges.forEach(edge => {
      const source = graphData.nodes.find(n => n.id === edge.source)
      const target = graphData.nodes.find(n => n.id === edge.target)
      if (source && target) {
        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)
        ctx.stroke()

        // Draw edge label
        if (edge.label) {
          const midX = (source.x + target.x) / 2
          const midY = (source.y + target.y) / 2
          ctx.fillStyle = '#6b7280'
          ctx.font = '12px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(edge.label, midX, midY)
        }
      }
    })

    // Draw nodes
    graphData.nodes.forEach(node => {
      const isSelected = selectedNode?.id === node.id

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2)

      // Fill color based on type
      if (node.type === 'concept') {
        ctx.fillStyle = isSelected ? '#2563eb' : '#3b82f6'
      } else if (node.type === 'entity') {
        ctx.fillStyle = isSelected ? '#059669' : '#10b981'
      } else {
        ctx.fillStyle = isSelected ? '#d97706' : '#f59e0b'
      }
      ctx.fill()

      // Node border
      ctx.strokeStyle = isSelected ? '#1d4ed8' : '#fff'
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.stroke()

      // Node label
      ctx.fillStyle = '#1D1E1F'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(node.label, node.x, node.y + node.size + 20)
    })

    ctx.restore()
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graphData || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left - offset.x) / zoom
    const y = (e.clientY - rect.top - offset.y) / zoom

    const clickedNode = graphData.nodes.find(node => {
      const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2)
      return distance <= node.size
    })

    if (clickedNode) {
      setSelectedNode(clickedNode)
      setDrawerVisible(true)
    } else {
      setSelectedNode(null)
    }
  }

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3))
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.3))
  const handleReset = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setSelectedNode(null)
  }

  const handleSearch = (text?: string) => {
    const searchValue = text ?? searchText
    if (!searchValue.trim() || !graphData) return
    const found = graphData.nodes.find(n =>
      n.label.toLowerCase().includes(searchValue.toLowerCase())
    )
    if (found) {
      setSelectedNode(found)
      setDrawerVisible(true)
    } else {
      message.info('未找到匹配节点')
    }
  }

  return (
    <div className="graph-view">
      {/* Header */}
      <div className="graph-header">
        <h2>知识图谱</h2>
        <div className="graph-actions">
          <Search
            mode="expanded"
            placeholder="搜索节点..."
            value={searchText}
            onDebouncedChange={(val) => {
              setSearchText(val)
              handleSearch(val)
            }}
            className="w-[200px]"
          />
          <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} />
          <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
          <Button icon={<FullscreenOutlined />} onClick={handleReset} />
          <Button icon={<ReloadOutlined />} onClick={loadGraphData} />
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="graph-container" ref={containerRef}>
        {loading ? (
          <div className="graph-loading">
            <Spin size="large" />
            <span>加载图谱中...</span>
          </div>
        ) : !graphData || graphData.nodes.length === 0 ? (
          <div className="graph-empty">
            <Empty description="暂无知识图谱数据" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="graph-canvas"
            onClick={handleCanvasClick}
          />
        )}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        <div className="legend-item">
          <div className="legend-color concept" />
          <span>概念</span>
        </div>
        <div className="legend-item">
          <div className="legend-color entity" />
          <span>实体</span>
        </div>
        <div className="legend-item">
          <div className="legend-color document" />
          <span>文档</span>
        </div>
      </div>

      {/* Node Detail Drawer */}
      <Drawer
        title="节点详情"
        placement="right"
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        styles={{ wrapper: { width: 400 } }}
      >
        {selectedNode && (
          <div className="node-detail">
            <div className="detail-item">
              <label>名称</label>
              <p>{selectedNode.label}</p>
            </div>
            <div className="detail-item">
              <label>类型</label>
              <p>{selectedNode.type === 'concept' ? '概念' : selectedNode.type === 'entity' ? '实体' : '文档'}</p>
            </div>
            <div className="detail-item">
              <label>关联节点</label>
              <div className="related-nodes">
                {graphData?.edges
                  .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
                  .map(e => {
                    const relatedId = e.source === selectedNode.id ? e.target : e.source
                    const relatedNode = graphData?.nodes.find(n => n.id === relatedId)
                    return relatedNode ? (
                      <div key={e.id} className="related-node">
                        <NodeIndexOutlined />
                        <span>{relatedNode.label}</span>
                        {e.label && <span className="relation">{e.label}</span>}
                      </div>
                    ) : null
                  })}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default LibraryGraphView
