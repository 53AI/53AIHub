import { createContext, useContext, useRef, ReactNode, RefObject } from 'react'
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType, type ResourceType } from '@/components/KMPermission/constant'
import { ApplyDialog, ApplyDialogRef } from '@/views/library/components/apply'

export interface ApplyData {
  permission: PermissionType
  resource: {
    id: string
    icon: string
    name: string
    [key: string]: any
  }
  resourceType: ResourceType
}

interface PermissionApplyContextValue {
  openApply: (data: ApplyData) => void
  applyRef: RefObject<ApplyDialogRef | null>
}

const PermissionApplyContext = createContext<PermissionApplyContextValue | null>(null)

export function PermissionApplyProvider({ children }: { children: ReactNode }) {
  const applyRef = useRef<ApplyDialogRef | null>(null)

  const openApply = (data: ApplyData) => {
    applyRef.current?.open(data)
  }

  return (
    <PermissionApplyContext.Provider value={{ openApply, applyRef }}>
      {children}
      <ApplyDialog ref={applyRef} />
    </PermissionApplyContext.Provider>
  )
}

export function usePermissionApply() {
  const context = useContext(PermissionApplyContext)
  if (!context) {
    throw new Error('usePermissionApply must be used within PermissionApplyProvider')
  }
  return context
}

export function usePermissionApplyRef() {
  const context = useContext(PermissionApplyContext)
  if (!context) {
    throw new Error('usePermissionApplyRef must be used within PermissionApplyProvider')
  }
  return context.applyRef
}
