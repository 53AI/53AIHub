assistant 优化
https://juejin.cn/post/7504991619054485554?share_token=46123f7b-edbc-4b9c-992e-4786077cae30

https://github.com/yuguaa/tbc-ai-kit/blob/master/packages%2Fapp%2Fsrc%2Fcomponents%2FYMarkdownRender%2Findex.vue


```vue
<script>
import Think from './Think.vue'
import YuguBlock from './YuguBlock.vue'
import md from './MarkdowEngine/index.js'

export default {
  name: 'YMdRenderer',
  components: {
    Think,
    YuguBlock,
  },
  props: {
    content: {
      type: String,
      required: true,
    },
  },
  computed: {
    tokens() {
      return md.parse(this.content, {})
    },
  },
  methods: {
    renderTokens(h, tokens, keyPrefix = '') {
      const result = []
      const stack = []
      const tagMap = {
        paragraph_open: 'p',
        heading_open: 'h1',
        bullet_list_open: 'ul',
        ordered_list_open: 'ol',
        list_item_open: 'li',
        image: 'img',
        link_open: 'a',
        code_inline: 'code',
        strong_open: 'strong',
        em_open: 'em',
        del_open: 'del',
        blockquote_open: 'blockquote',
        table_open: 'table',
        thead_open: 'thead',
        tbody_open: 'tbody',
        tr_open: 'tr',
        th_open: 'th',
        td_open: 'td',
        hr: 'hr',
        fence: 'pre',
        hardbreak: 'br',
        inline: 'span',
        text: 'span',
        think: Think, // 处理 think 标签
        yugu_block_open: 'div',
      }
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token.type === 'link_open') {
          const linkTokens = []
          let j = i
          while (j < tokens.length) {
            linkTokens.push(tokens[j])
            if (tokens[j].type === 'link_close') break
            j++
          }
          const html = md.renderer.render(linkTokens, md.options, {})
          const vnode = h('span', {
            key: `${keyPrefix}-link-${i}`,
            domProps: { innerHTML: html },
          })
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
          i = j // 跳过处理过的 link token
          continue
        }
        if (token.type === 'yugu_block_open') {
          const blockTokens = []
          let j = i
          while (j < tokens.length) {
            blockTokens.push(tokens[j])
            if (tokens[j].type === 'yugu_block_close') break
            j++
          }
          const vnode = h(
            YuguBlock,
            {
              key: `${keyPrefix}-yugu-block-${i}`, // 设置唯一 key
              class: 'yugu-block',
              attrs: token.meta,
            },
            this.renderTokens(h, blockTokens.slice(1, blockTokens.length - 1), `${keyPrefix}-yugu-block-slot-${i}`),
          )
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
          i = j // 跳过处理过的 yugu_block token
          continue
        }
        if (token.type === 'fence') {
          const html = md.renderer.render([token], md.options, {})
          const vnode = h('span', {
            key: `${keyPrefix}-fence-${i}`,
            domProps: { innerHTML: html },
          })
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
          continue
        }
        if (token.type === 'html_inline') {
          const html = md.renderer.render([token], md.options, {})
          const vnode = h('span', {
            key: `${keyPrefix}-html-inline-${i}`,
            domProps: { innerHTML: html },
          })
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
          continue
        }
        if (token.type === 'think') {
          const vnode = h(
            Think,
            {
              class: 'think-inline',
              props: token.meta,
            },
            this.renderTokens(h, md.parse(token.content, {}), `${keyPrefix}-think`),
          )
          result.push(vnode)
        } else if (/_open$/.test(token.type)) {
          stack.push({ token, children: [] })
        } else if (/_close$/.test(token.type)) {
          const { token: openToken, children } = stack.length && stack.pop()
          const tag = openToken?.tag || tagMap[openToken?.type] || 'div'
          const attrs = {}
          if (openToken?.attrs) {
            openToken.attrs.forEach(([k, v]) => (attrs[k] = v))
          }
          const vnode = h(tag, { key: `${keyPrefix}-${i}`, attrs }, children)
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
        } else if (token.type === 'inline') {
          const children = this.renderTokens(h, token.children || [], `${keyPrefix}-inline-${i}`)
          if (stack.length) {
            stack[stack.length - 1].children.push(...children)
          } else {
            result.push(...children)
          }
        } else if (token.type === 'text') {
          const vnode = token.content
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
        } else {
          const tag = token.tag || tagMap[token.type] || 'span'
          const attrs = {}

          if (token.attrs) {
            token.attrs.forEach(([k, v]) => (attrs[k] = v))
          }
          const vnode = h(tag, { key: `${keyPrefix}-${i}`, attrs }, token.content || [])
          if (stack.length) {
            stack[stack.length - 1].children.push(vnode)
          } else {
            result.push(vnode)
          }
        }
      }
      return result
    },
  },
  render(h) {
    return h('div', { class: 'markdown-body' }, this.renderTokens(h, this.tokens))
  },
}
</script>

<style lang="less" scoped>
@import 'github-markdown-css/github-markdown-light.css';
.markdown-body {
  font-size: 16px;
  color: #262626;
  code {
    display: inline-block;
  }
}
</style>
```
