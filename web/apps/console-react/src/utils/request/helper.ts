/**
 * Stream helper functions for handling SSE responses
 */

interface StreamResult {
  event?: string
  answer?: string
  text?: string
  [key: string]: any
}

/**
 * Parse SSE stream response text
 */
export const stream = (result: { event: { target: XMLHttpRequest } }): StreamResult[] => {
  const xhr = result.event.target
  const { responseText } = xhr
  return responseText
    .split('data: ')
    .map((text) => {
      if (!text) return ''
      const lastIndex = text.lastIndexOf('}')
      let chunk = text
      if (lastIndex !== -1) chunk = text.slice(0, lastIndex + 1)
      try {
        return JSON.parse(chunk)
      } catch {
        return ''
      }
    })
    .filter((item): item is StreamResult => !!item)
}

/**
 * Format stream results into a single object
 */
export const formatNormal = (
  list: StreamResult[],
  options?: { answerKey?: string; textKey?: string }
): { text: string; answer: string; [key: string]: any } => {
  const { answerKey = 'answer', textKey = 'text' } = options || {}

  return list.reduce(
    (result, item) => {
      Object.assign(result, item)
      result[textKey] += item[answerKey] || ''
      if (item.event === 'message_replace') result[textKey] = item[answerKey] || ''
      return result
    },
    { text: '', answer: '' }
  )
}
