import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Drawer } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { GraphViewerWidget } from '@/views/library/main/file/chunks'

interface KnowledgeGraphDrawerProps {
  onClose?: () => void
}

export interface KnowledgeGraphDrawerRef {
  open: (data: { graph: { entities?: any[]; relations?: any[] } }) => void
  close: () => void
}

export const KnowledgeGraphDrawer = forwardRef<KnowledgeGraphDrawerRef, KnowledgeGraphDrawerProps>(
  ({ onClose }, ref) => {
    const [visible, setVisible] = useState(false)
    const graphRef = useRef<any>(null)

    useImperativeHandle(ref, () => ({
      open: async (data: { graph: { entities?: any[]; relations?: any[] } }) => {
        setVisible(true)
        setTimeout(() => {
          graphRef.current?.setGraphData({
            entities: data.graph?.entities || [],
            relations: data.graph?.relations || [],
          })
        }, 100)
      },
      close: handleClose,
    }))

    const handleClose = useCallback(() => {
      setVisible(false)
      onClose?.()
    }, [onClose])

    return (
      <Drawer
        open={visible}
        onClose={handleClose}
        placement="left"
        destroyOnHidden
        mask={false}
        title={
          <div className="flex items-center gap-2 pl-5">
            <div className="size-6 flex-shrink-0 rounded flex items-center justify-center bg-[#145CF7] text-white">
              <SvgIcon name="six-points" />
            </div>
            <div className="flex-1 text-base text-[#1D1E1F] truncate">知识图谱</div>
          </div>
        }
        styles={{
          wrapper: { width: 'calc(100vw - 418px)', boxShadow: 'none' },
          header: { padding: '16px 24px' },
          body: { padding: 0 },
        }}
      >
        <div className="h-full overflow-hidden">
          <GraphViewerWidget ref={graphRef} empty={false} />
        </div>
      </Drawer>
    )
  },
)

KnowledgeGraphDrawer.displayName = 'KnowledgeGraphDrawer'

export default KnowledgeGraphDrawer
