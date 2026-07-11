import { useState, useEffect, useImperativeHandle, forwardRef, ReactNode } from 'react'

interface LazyComponentProps {
  value: string | number
  name: string
  cache?: boolean
  children?: ReactNode
  onLoad?: () => void
  onShow?: () => void
}

export interface LazyComponentRef {
  reset: () => Promise<void>
}

export const LazyComponent = forwardRef<LazyComponentRef, LazyComponentProps>(
  ({ value, name, cache = true, children, onLoad, onShow }, ref) => {
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
      if (value === name) {
        if (!loaded) {
          setLoaded(true)
          onLoad?.()
        }
        onShow?.()
      } else {
        if (!cache) {
          setLoaded(false)
        }
      }
    }, [value, name, cache, loaded, onLoad, onShow])

    useImperativeHandle(ref, () => ({
      async reset() {
        setLoaded(false)
      },
    }))

    if (!loaded) return null

    return <div style={{ display: name === value ? 'block' : 'none' }}>{children}</div>
  }
)

export default LazyComponent
