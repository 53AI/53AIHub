import type { Plugin } from 'vite'

interface ConditionalCompilationOptions {
  // 当前平台类型
  platform?: string
  // 是否开启调试模式
  debug?: boolean
}

// 版本常量映射 - 对应项目中的版本
const PLATFORM_CONSTANTS = {
  SAAS: '', // SAAS版是默认版本，VITE_PLATFORM 为空或未设置
  KM: 'km', // KM版
}

// 预编译正则表达式提高性能
const CONDITIONAL_REGEX = {
  // 快速检测是否包含条件编译指令
  hasConditional: /#(?:ifdef|ifndef|endif)\b/,

  // ifdef 指令匹配
  ifdef: [/^\/\/\s*#ifdef\s+(.+)/, /^<!--\s*#ifdef\s+(.+?)\s*-->/, /^\/\*\s*#ifdef\s+(.+?)\s*\*\//],

  // ifndef 指令匹配
  ifndef: [
    /^\/\/\s*#ifndef\s+(.+)/,
    /^<!--\s*#ifndef\s+(.+?)\s*-->/,
    /^\/\*\s*#ifndef\s+(.+?)\s*\*\//,
  ],

  // endif 指令匹配
  endif: [/^\/\/\s*#endif/, /^<!--\s*#endif\s*-->/, /^\/\*\s*#endif\s*\*\//],
}

/**
 * 评估单个条件
 */
function evaluateSingleCondition(condition: string, currentPlatform: string): boolean {
  const cleanCondition = condition.trim().toUpperCase()
  const platformValue = PLATFORM_CONSTANTS[cleanCondition as keyof typeof PLATFORM_CONSTANTS]

  if (platformValue === undefined) {
    console.warn(`[条件编译] 未知的平台常量: ${cleanCondition}`)
    return false
  }

  return platformValue === currentPlatform
}

/**
 * 处理 OR 表达式
 */
function evaluateOrExpression(expression: string, currentPlatform: string): boolean {
  const orParts = expression.split('||')
  for (let i = 0; i < orParts.length; i++) {
    if (evaluateSingleCondition(orParts[i].trim(), currentPlatform)) {
      return true
    }
  }
  return false
}

/**
 * 解析条件表达式
 * 支持：SAAS, KM
 * 支持逻辑操作符：|| (或)
 * 示例：SAAS || KM
 * @param expression 条件表达式
 * @param currentPlatform 当前平台
 * @returns 是否满足条件
 */
function evaluateCondition(expression: string, currentPlatform: string): boolean {
  // 移除多余空格并转换为大写
  const cleanExpression = expression.trim().toUpperCase()

  // 如果表达式包含 || 操作符，处理 OR 表达式
  if (cleanExpression.includes('||')) {
    return evaluateOrExpression(cleanExpression, currentPlatform)
  }

  // 单个条件
  return evaluateSingleCondition(cleanExpression, currentPlatform)
}

/**
 * 匹配条件编译指令
 */
function matchDirective(line: string, regexArray: RegExp[]): RegExpMatchArray | null {
  for (let i = 0; i < regexArray.length; i++) {
    const match = line.match(regexArray[i])
    if (match) return match
  }
  return null
}

/**
 * 条件编译 Vite 插件
 * 支持 #ifdef, #ifndef, #endif 指令进行条件编译
 *
 * 使用示例：
 * // #ifdef SAAS
 * console.log('只在 SAAS 版本中编译')
 * // #endif
 *
 * // #ifdef SAAS || KM
 * console.log('在 SAAS 版本和开源版中编译')
 * // #endif
 *
 * // #ifndef KM
 * console.log('在除了 KM 版本之外的版本中编译')
 * // #endif
 */
export function conditionalCompilation(options: ConditionalCompilationOptions = {}): Plugin {
  const { platform = '', debug = false } = options

  // 根据环境变量确定当前平台
  const currentPlatform = platform || process.env.VITE_PLATFORM || ''

  console.log(`[条件编译] 插件初始化 - 当前平台: "${currentPlatform}", 调试模式: ${debug}`)

  /**
   * 解析条件编译指令 - 优化版本
   * @param content 文件内容
   * @returns 处理后的内容
   */
  function parseConditionalCompilation(content: string): string {
    // 早期退出：如果内容不包含条件编译指令，直接返回
    if (!CONDITIONAL_REGEX.hasConditional.test(content)) {
      return content
    }

    const lines = content.split('\n')
    const result: string[] = []

    let currentShouldInclude = false
    let hasChanges = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // 检测条件编译指令
      const ifdefMatch = matchDirective(trimmedLine, CONDITIONAL_REGEX.ifdef)
      const ifndefMatch = matchDirective(trimmedLine, CONDITIONAL_REGEX.ifndef)
      const endifMatch = matchDirective(trimmedLine, CONDITIONAL_REGEX.endif)
      if (ifdefMatch) {
        currentShouldInclude = !evaluateCondition(ifdefMatch[1], currentPlatform)
        hasChanges = currentShouldInclude
      } else if (ifndefMatch) {
        currentShouldInclude = evaluateCondition(ifndefMatch[1], currentPlatform)
        hasChanges = currentShouldInclude
      }

      // 处理非条件编译指令行
      if (!currentShouldInclude) {
        result.push(line)
      }
      if (endifMatch) {
        currentShouldInclude = false
        hasChanges = true
      }
    }

    // 如果没有变化，返回原内容避免不必要的字符串操作
    return hasChanges ? result.join('\n') : content
  }

  /**
   * 处理 Vue 文件的条件编译 - 优化版本
   */
  function processVueFile(content: string, filePath: string): string {
    // 早期退出：如果内容不包含条件编译指令，直接返回
    if (!CONDITIONAL_REGEX.hasConditional.test(content)) {
      return content
    }

    // 优化的 Vue 文件处理：减少正则匹配次数
    let hasChanges = false
    const processedContent = parseConditionalCompilation(content)
    if (processedContent !== content) {
      hasChanges = true
    }
    return hasChanges ? processedContent : content
  }

  return {
    name: 'conditional-compilation',
    enforce: 'pre', // 在其他插件之前执行
    transform(code: string, id: string) {
      // 只处理源码文件，排除 node_modules
      if (id.includes('node_modules')) {
        return null
      }

      // 早期退出：如果代码不包含条件编译指令，直接跳过
      if (!CONDITIONAL_REGEX.hasConditional.test(code)) {
        return null
      }

      let processedCode: string

      // 根据文件类型处理条件编译
      if (id.endsWith('.vue')) {
        processedCode = processVueFile(code, id)
      } else if (id.endsWith('.ts') || id.endsWith('.js')) {
        processedCode = parseConditionalCompilation(code)
      } else {
        return null
      }

      // 如果内容有变化，返回处理后的代码
      if (processedCode !== code) {
        return {
          code: processedCode,
          map: null, // 可以添加 source map 支持
        }
      }

      return null
    },
  }
}

export default conditionalCompilation
