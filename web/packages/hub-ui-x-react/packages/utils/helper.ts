export function onClickOutside(node: Node, callback: () => void) {

    const handleClick = (event: MouseEvent) => {
      if (!node) return;
      if (!node.contains(event.target as Node)) {
          callback();
      }
    }

    document.addEventListener('click', handleClick, true);

    return {
        destroy() {
            document.removeEventListener('click', handleClick, true);
        }
    }
}
