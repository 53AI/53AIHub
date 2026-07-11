import { defineComponent } from 'vue'

type CallFun = (vnodeEl: HTMLElement) => void
type Funs = Record<'mountedCallFun' | 'updatedCallFun' | 'unmountedCallFun', CallFun>

export default ({ mountedCallFun, updatedCallFun, unmountedCallFun }: Funs) => {
  return defineComponent({
    props: ['vnode'],
    setup(props, ctx) {},
    mounted() {
      mountedCallFun(this.$el)
    },
    render(props: any, ctx: any) {
      return props.vnode
    },
  })
}
