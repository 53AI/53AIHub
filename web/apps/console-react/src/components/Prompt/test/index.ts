import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import LinkComponent from './component'

export interface LinkNodeOptions {
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkNode: {
      setLink: (options: { value: string; defaultValue: string; type?: string }) => ReturnType
    }
  }
}

export const LinkNode = Node.create<LinkNodeOptions>({
  name: 'link',

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      value: {
        default: '',
      },
      defaultValue: {
        default: '',
      },
      type: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'link',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['link', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkComponent)
  },

  addCommands() {
    return {
      setLink:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})

export default LinkNode