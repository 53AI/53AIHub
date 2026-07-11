import FingerprintJS from '@fingerprintjs/fingerprintjs'

const DEVICE_ID_KEY = 'device_id'

/**
 * Generate UUID v4 without external library
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Get or create a persistent device ID from localStorage
 */
function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }
  const newId = generateUUID()
  localStorage.setItem(DEVICE_ID_KEY, newId)
  return newId
}

/**
 * Get visitor fingerprint using FingerprintJS with localStorage fallback
 * Priority: localStorage cached ID > FingerprintJS > UUID fallback
 */
export async function getFingerprint(): Promise<string> {
  // Check localStorage first (persists across sessions)
  const cachedId = localStorage.getItem(DEVICE_ID_KEY)
  if (cachedId) {
    return cachedId
  }

  try {
    // Try FingerprintJS
    const fp = await FingerprintJS.load()
    const result = await fp.get()
    const visitorId = result.visitorId
    // Cache for future use
    localStorage.setItem(DEVICE_ID_KEY, visitorId)
    return visitorId
  } catch {
    // Fallback to UUID
    return getOrCreateDeviceId()
  }
}

/**
 * Clear device ID from localStorage (for logout/reset)
 */
export function clearFingerprint(): void {
  localStorage.removeItem(DEVICE_ID_KEY)
}