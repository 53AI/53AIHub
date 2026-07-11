import {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useMemo,
} from "react"
import CodeMirror from "@uiw/react-codemirror"
import {
  EditorView,
  Decoration,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  keymap,
  showTooltip,
  Tooltip,
} from "@codemirror/view"
import { StateEffect, StateField } from "@codemirror/state"
import "./index.css"

/**
 * 计算 token 数量（基于 GPT tokenizer 简化规则）
 */
const calculateTokens = (text: string): number => {
  if (!text || text.trim().length === 0) return 0

  let tokenCount = 0
  let i = 0

  while (i < text.length) {
    const char = text[i]
    const charCode = char.charCodeAt(0)

    if (charCode >= 0x4e00 && charCode <= 0x9fff) {
      tokenCount += 1
      i++
    } else if (charCode >= 48 && charCode <= 57) {
      let numLength = 0
      while (
        i < text.length &&
        text.charCodeAt(i) >= 48 &&
        text.charCodeAt(i) <= 57
      ) {
        numLength++
        i++
      }
      tokenCount += Math.ceil(numLength / 3.5)
    } else if (
      (charCode >= 65 && charCode <= 90) ||
      (charCode >= 97 && charCode <= 122)
    ) {
      let wordLength = 0
      while (
        i < text.length &&
        ((text.charCodeAt(i) >= 65 && text.charCodeAt(i) <= 90) ||
          (text.charCodeAt(i) >= 97 && text.charCodeAt(i) <= 122))
      ) {
        wordLength++
        i++
      }
      if (wordLength <= 3) {
        tokenCount += 1
      } else if (wordLength <= 6) {
        tokenCount += 1.5
      } else {
        tokenCount += Math.ceil(wordLength / 4)
      }
    } else if (char === " " || char === "\n" || char === "\t") {
      i++
    } else {
      tokenCount += 0.3
      i++
    }
  }

  return Math.round(tokenCount)
}

export interface VariableItem {
  label: string
  value: string
}

export interface VariableGroup {
  label: string
  children: VariableItem[]
}

export interface AgentInfo {
  icon: string
  name: string
}

export interface PromptInputProps {
  value?: string
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  showLine?: boolean
  showToken?: boolean
  wordWrap?: boolean
  variables?: VariableGroup[]
  agentInfo?: AgentInfo
  maxLength?: number
  showCount?: boolean
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  style?: React.CSSProperties
  className?: string
  /** 翻译函数，默认使用 window.$t */
  t?: (key: string) => string
}

export interface PromptInputRef {
  showTooltip: () => void
  insertContent: (content: string) => void
  forceUpdate: (text?: string) => void
  scrollToBottom: () => void
}

class VariableWidget extends WidgetType {
  name: string
  value: string

  constructor(name: string, value: string) {
    super()
    this.name = name
    this.value = value
  }

  eq(other: VariableWidget) {
    return this.name === other.name
  }

  toDOM() {
    const elt = document.createElement("span")
    elt.style.cssText = `
      color: rgb(42, 100, 231);
      padding: 0 4px;
    `
    elt.textContent = this.name
    return elt
  }

  ignoreEvent() {
    return false
  }
}

const addTooltip = StateEffect.define<{
  pos: number
  above?: boolean
  create: () => { dom: HTMLElement }
} | null>()

const tooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update: (tooltip, tr) => {
    for (const e of tr.effects) {
      if (e.is(addTooltip)) return e.value
    }
    return tooltip
  },
  provide: (f) => showTooltip.from(f),
})

const createVariableMatcher = (variables: VariableGroup[]) => {
  const findVariableByValue = (value: string) => {
    for (const group of variables) {
      const found = group.children.find((item) => item.value === value)
      if (found) return { ...found, group: group.label }
    }
    return null
  }

  return new MatchDecorator({
    regexp: /(\{\#(\S+?)\#\}|\{\{(\S+?)\}\})/g,
    decoration: (match) => {
      const variable = findVariableByValue(match[0])
      if (variable) {
        return Decoration.replace({
          widget: new VariableWidget(variable.label, match[1]),
        })
      }
      return null
    },
  })
}

const defaultT = (key: string): string => {
  if (typeof window !== "undefined" && typeof (window as any).$t === "function") {
    return (window as any).$t(key)
  }
  return key
}

export const PromptInput = forwardRef<PromptInputRef, PromptInputProps>(
  (
    {
      value: controlledValue,
      defaultValue = "",
      placeholder,
      disabled = false,
      showLine = false,
      showToken = false,
      wordWrap = false,
      variables = [],
      agentInfo,
      maxLength,
      showCount = false,
      onChange,
      onFocus,
      onBlur,
      style,
      className = "",
      t = defaultT,
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = useState(defaultValue)
    const [token, setToken] = useState(0)
    const editorViewRef = useRef<EditorView | null>(null)
    const tooltipDomRef = useRef<HTMLElement | null>(null)
    const selectedIndexRef = useRef(0)

    const value =
      controlledValue !== undefined ? controlledValue : internalValue

    const tokenTimerRef = useRef<NodeJS.Timeout>()
    const calcToken = useCallback(() => {
      if (!showToken) return
      clearTimeout(tokenTimerRef.current)
      tokenTimerRef.current = setTimeout(() => {
        const tokens = calculateTokens(value)
        setToken(value.trim() ? tokens : 0)
      }, 200)
    }, [value, showToken])

    useEffect(() => {
      calcToken()
      return () => clearTimeout(tokenTimerRef.current)
    }, [value, calcToken])

    const hideTooltip = useCallback(() => {
      if (editorViewRef.current) {
        editorViewRef.current.dispatch({
          effects: addTooltip.of(null),
        })
      }
      document.removeEventListener("keydown", handleKeyDown, true)
    }, [])

    const handleKeyDown = useCallback(
      (event: KeyboardEvent) => {
        if (!tooltipDomRef.current) return

        const items = tooltipDomRef.current.querySelectorAll(".tooltip-item")
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp":
            event.preventDefault()
            event.stopPropagation()
            const direction = event.key === "ArrowDown" ? 1 : -1
            selectedIndexRef.current = Math.max(
              0,
              Math.min(selectedIndexRef.current + direction, items.length - 1),
            )
            updateSelectedItem(items)
            break
          case "Enter":
            event.preventDefault()
            event.stopPropagation()
            if (selectedIndexRef.current >= 0) {
              const node = items[selectedIndexRef.current] as HTMLElement
              node.click()
              hideTooltip()
            }
            break
        }
      },
      [hideTooltip],
    )

    const updateSelectedItem = (items: NodeListOf<Element>) => {
      items.forEach((item, index) => {
        if (index === selectedIndexRef.current) {
          item.classList.add("selected")
          item.scrollIntoView({ block: "nearest" })
        } else {
          item.classList.remove("selected")
        }
      })
    }

    const insertContentAt = useCallback(
      (from: number, to: number, content: string) => {
        editorViewRef.current?.dispatch({
          changes: {
            from,
            to,
            insert: content,
          },
        })
      },
      [],
    )

    const showVarTooltip = useCallback(
      (pos: number, to: number) => {
        if (!variables.length) return
        if (!editorViewRef.current) return

        const dom = document.createElement("div")
        dom.className = "variable-tooltip"
        dom.style.cssText = `
          min-width: 300px;
          max-height: 250px;
          overflow-y: auto;
          background-color: white;
          padding: 16px;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        `
        tooltipDomRef.current = dom

        if (agentInfo && (agentInfo.icon || agentInfo.name)) {
          const agentHeader = document.createElement("div")
          agentHeader.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"

          if (agentInfo.icon) {
            const iconImg = document.createElement("img")
            iconImg.src = agentInfo.icon
            iconImg.style.cssText = "width: 32px; height: 32px; border-radius: 4px;"
            agentHeader.appendChild(iconImg)
          }

          if (agentInfo.name) {
            const nameEl = document.createElement("p")
            nameEl.style.cssText = "flex: 1; font-size: 14px; color: #1D1E1F; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0;"
            nameEl.textContent = agentInfo.name
            agentHeader.appendChild(nameEl)
          }

          dom.appendChild(agentHeader)
        }

        variables.forEach((group) => {
          const groupTitle = document.createElement("div")
          groupTitle.className = "tooltip-title"
          groupTitle.textContent = group.label
          dom.appendChild(groupTitle)

          group.children.forEach((variable) => {
            const item = document.createElement("div")
            item.className = "tooltip-item"
            item.textContent = variable.label
            ;(item as any).dataset.value = variable.value
            item.onclick = () => {
              insertContentAt(pos, to, variable.value)
              hideTooltip()
            }
            dom.appendChild(item)
          })
        })

        editorViewRef.current.dispatch({
          effects: addTooltip.of({
            pos,
            above: true,
            create: () => ({ dom }),
          }),
        })

        selectedIndexRef.current = 0
        setTimeout(() => {
          const items = dom.querySelectorAll(".tooltip-item")
          if (items.length > 0) {
            items[0].classList.add("selected")
          }
          document.addEventListener("keydown", handleKeyDown, true)
        }, 0)
      },
      [variables, agentInfo, insertContentAt, hideTooltip, handleKeyDown],
    )

    const extensions = useMemo(() => {
      const exts: any[] = []

      exts.push(
        EditorView.updateListener.of((update) => {
          editorViewRef.current = update.view
          if (update.docChanged) {
            update.view.dispatch({
              effects: addTooltip.of(null),
            })
          }
        }),
      )

      if (wordWrap) {
        exts.push(EditorView.lineWrapping)
      }

      if (variables && variables.length) {
        const variableMatcher = createVariableMatcher(variables)

        const variablePlugin = ViewPlugin.fromClass(
          class {
            decorations: any
            constructor(view: EditorView) {
              this.decorations = variableMatcher.createDeco(view)
            }
            update(update: any) {
              this.decorations = variableMatcher.updateDeco(
                update,
                this.decorations,
              )
            }
          },
          {
            decorations: (instance) => instance.decorations,
            provide: (plugin) =>
              EditorView.atomicRanges.of((view) => {
                return view.plugin(plugin)?.decorations || Decoration.none
              }),
          },
        )

        exts.push(variablePlugin, tooltipField)

        exts.push(
          keymap.of([
            {
              key: "/",
              run: (view) => {
                const pos = view.state.selection.main.head
                setTimeout(() => {
                  if (view.state.selection.main.head === pos + 1) {
                    showVarTooltip(pos, pos + 1)
                  }
                }, 200)
                return false
              },
            },
          ]),
        )
      }

      return exts
    }, [wordWrap, variables, showVarTooltip])

    useEffect(() => {
      const handleGlobalClick = (event: MouseEvent) => {
        if (
          tooltipDomRef.current &&
          !tooltipDomRef.current.contains(event.target as Node)
        ) {
          hideTooltip()
        }
      }
      document.addEventListener("click", handleGlobalClick)
      return () => document.removeEventListener("click", handleGlobalClick)
    }, [hideTooltip])

    const handleChange = (val: string) => {
      const finalVal = maxLength !== undefined && val.length > maxLength
        ? val.slice(0, maxLength)
        : val
      setInternalValue(finalVal)
      onChange?.(finalVal)
    }

    const insertContent = (content: string) => {
      const pos = editorViewRef.current?.state.selection.main.head ?? 0
      insertContentAt(pos, pos, content)
    }

    const scrollToBottom = () => {
      if (editorViewRef.current) {
        const lastLine = editorViewRef.current.state.doc.lines - 1
        const lastLineEnd = editorViewRef.current.state.doc.line(lastLine).to
        editorViewRef.current.dispatch({
          selection: { anchor: lastLineEnd, head: lastLineEnd },
          scrollIntoView: true,
        })
      }
    }

    useImperativeHandle(ref, () => ({
      showTooltip: () => {
        const pos = editorViewRef.current?.state.selection.main.head ?? 0
        showVarTooltip(pos, pos)
      },
      insertContent,
      forceUpdate: (text = "") => {
        setInternalValue(text)
        onChange?.(text)
      },
      scrollToBottom,
    }), [showVarTooltip, insertContent, scrollToBottom])

    return (
      <div
        className={`prompt-input-wrapper flex flex-col ${showLine ? "show-line" : "hide-line"} ${className}`}
        style={style}
      >
        <CodeMirror
          value={value}
          height="auto"
          extensions={extensions}
          onChange={handleChange}
          readOnly={disabled}
          placeholder={placeholder || t("form.input_placeholder")}
          className="prompt-codemirror flex-1"
          theme="light"
          onFocus={onFocus}
          onBlur={onBlur}
          basicSetup={{
            lineNumbers: showLine,
            foldGutter: false,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: false,
            bracketMatching: false,
            closeBrackets: false,
            autocompletion: false,
            rectangularSelection: false,
            crosshairCursor: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            highlightSelectionMatches: false,
          }}
        />
        {showToken && (
          <div className="px-2 py-px text-right text-[#182B50] text-opacity-60 text-xs">
            {token} {t("tokens") || "tokens"}
          </div>
        )}
        {showCount && maxLength !== undefined && (
          <div className="px-2 py-px text-right text-[#182B50] text-opacity-60 text-xs">
            {value.length}/{maxLength}
          </div>
        )}
      </div>
    )
  },
)

PromptInput.displayName = "PromptInput"

export default PromptInput
