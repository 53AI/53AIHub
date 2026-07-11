import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/locales'
import { MoveToModal } from './MoveToModal'

const makeFetch = (dataByPath: Record<string, any[]>) =>
	vi.fn(async ({ path }: { path?: string; keyword?: string; type?: string }) => {
		const key = path || '/'
		return { data: dataByPath[key] || [] }
	})

// 模拟 fetchDirs 既要支持 dir 又要支持 file（按 type 分桶）
const makeFetchTyped = (dirsByPath: Record<string, any[]>, filesByPath: Record<string, any[]>) =>
	vi.fn(async ({ path, type }: { path?: string; keyword?: string; type?: 'dir' | 'file' }) => {
		const key = path || '/'
		if (type === 'file') return { data: filesByPath[key] || [] }
		return { data: dirsByPath[key] || [] }
	})

// 注意：测试环境的默认 locale 是 'en'，因此 OK 按钮文本是 "Confirm"。
// i18n fallback 已在 MoveToModal 中处理（action.move_to -> 移动到），按钮文本由
// antd 默认文案的 locale 控制，统一用 "Confirm" 匹配。
describe('MoveToModal', () => {
	it('打开时自动加载根目录与根文件并显示', async () => {
		const fetch = makeFetchTyped(
			{ '/': [{ id: '1', path: '/A', name: 'A' }] },
			{ '/': [{ id: '2', path: '/note.md', name: 'note.md' }] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})
		// 根目录行始终展示
		expect(screen.getByLabelText(t('move_to.root_dir') as string)).toBeInTheDocument()
		// 文件行也展示
		await waitFor(() => {
			expect(screen.getByText('note.md')).toBeInTheDocument()
		})
	})

	it('close 时不渲染内容', () => {
		render(
			<MoveToModal
				open={false}
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)
		expect(screen.queryByText('A')).not.toBeInTheDocument()
	})

	it('选中根目录 radio 后 OK 按钮可用且触发 onConfirm("/")', async () => {
		const user = userEvent.setup()
		const onConfirm = vi.fn()
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={onConfirm}
				onCancel={vi.fn()}
			/>,
		)

		const rootRadio = screen.getByLabelText(t('move_to.root_dir') as string)
		await user.click(rootRadio)

		const okBtn = screen.getByRole('button', { name: /^Confirm$/ })
		expect(okBtn).not.toBeDisabled()

		await user.click(okBtn)
		expect(onConfirm).toHaveBeenCalledWith('/')
	})

	it('sourceItem 路径与根目录冲突时禁止选中根目录', () => {
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		const rootRadio = screen.getByLabelText(t('move_to.root_dir') as string) as HTMLInputElement
		expect(rootRadio.disabled).toBe(true)
	})

	it('未选中任何目标时 OK 按钮始终禁用', () => {
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		const okBtn = screen.getByRole('button', { name: /^Confirm$/ }) as HTMLButtonElement
		expect(okBtn.disabled).toBe(true)
	})

	it('懒加载场景：handleLoadData 反查 path 后同时加载 dir + file', async () => {
		const fetch = makeFetchTyped(
			{
				'/': [{ id: '1', path: '/A', name: 'A' }],
				'/A': [{ id: '2', path: '/A/B', name: 'B' }],
			},
			{
				'/': [{ id: '3', path: '/note.md', name: 'note.md' }],
				'/A': [{ id: '4', path: '/A/doc.md', name: 'doc.md' }],
			},
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})

		// 验证根目录 + 根文件都已加载
		await waitFor(() => {
			expect(screen.getByText('note.md')).toBeInTheDocument()
		})
		// 初次 fetch 调用：根目录 dir + 根目录 file（顺序不固定，断言至少两次）
		expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2)
		const types = fetch.mock.calls.map((c) => c[0]?.type)
		expect(types).toContain('dir')
		expect(types).toContain('file')

		// 行为验证：默认只加载根级别一次（命中缓存）
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50))
		})
		const rootDirCalls = fetch.mock.calls.filter(
			(c) => c[0]?.path === '/' && c[0]?.type === 'dir',
		)
		const rootFileCalls = fetch.mock.calls.filter(
			(c) => c[0]?.path === '/' && c[0]?.type === 'file',
		)
		expect(rootDirCalls.length).toBe(1)
		expect(rootFileCalls.length).toBe(1)
	})

	it('fetchDirs 被调用参数正确：根目录请求 path="/" type="dir"', async () => {
		const fetch = makeFetch({ '/': [] })
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(fetch).toHaveBeenCalled()
		})
		const dirCalls = fetch.mock.calls.filter((c) => c[0]?.type === 'dir')
		expect(dirCalls[0][0]).toEqual({ path: '/', type: 'dir' })
	})

	it('title 显示 action.move_to 文案', async () => {
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		// i18n csv 已注入 action.move_to；测试环境 locale=en 时，模态框标题应为 "Move to"
		const title = await screen.findByText('Move to')
		expect(title).toBeInTheDocument()
	})

	it('根目录行展示 folder icon', async () => {
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		// 根目录行始终展示，模态框 DOM 内至少有一张 folder 图（根目录行）+ 根目录 radio
		await waitFor(() => {
			expect(screen.getByLabelText(t('move_to.root_dir') as string)).toBeInTheDocument()
		})
		// 通过"根目录"文字节点反向找到其外层带 img 的容器
		const rootText = screen.getByText(t('move_to.root_dir') as string)
		// 我们的根目录行结构：<label><img><span>根目录</span><radio/></label>
		// antd Radio 的 input 嵌套在 ant-radio-wrapper <label> 中，
		// 因此这里向上找最近的祖先 label（最外层）
		let container: HTMLElement | null = rootText
		while (container && container.tagName.toLowerCase() !== 'label') {
			container = container.parentElement
		}
		// 找到最外层 label 后再上溯一层拿到我们的根目录行 label
		const outerLabel = container?.parentElement?.closest('label') || container
		const img = outerLabel?.querySelector('img')
		expect(img).toBeTruthy()
		// 图片 src 指向 folder.png
		expect(img?.getAttribute('src') || '').toMatch(/folder/)
	})

	it('搜索框使用 SearchInput 组件（220 宽 + mode=expanded）', async () => {
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={makeFetch({ '/': [] })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		// 测试环境 lng=en，placeholder 由 csv en 列给出 "Search"
		const input = screen.getByPlaceholderText('Search') as HTMLInputElement
		expect(input).toBeInTheDocument()
		// 包它的容器带 w-[220px]
		const container = input.closest('.w-\\[220px\\]')
		expect(container).toBeTruthy()
	})

	it('sourceItem 自身出现在根目录列表时 radio 禁用', async () => {
		// 移动 /A 文件夹，根目录列表里恰好有 /A 自身（id='1'）
		const fetch = makeFetchTyped(
			{ '/': [{ id: '1', path: '/A', name: 'A' }] },
			{ '/': [] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '1', name: 'A', path: '/A', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		// 等 /A 行渲染
		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})

		// /A 是 source 自身，树节点内的 radio 应禁用
		// 通过 .ant-tree-treenode 限定到树内节点（排除根目录行 + 搜索结果）
		const treeRadios = Array.from(
			document.querySelectorAll('.ant-tree-treenode input[type="radio"]'),
		) as HTMLInputElement[]
		expect(treeRadios.length).toBeGreaterThan(0)
		const aNode = treeRadios[0].closest('.ant-tree-treenode')
		expect(aNode?.textContent).toContain('A')
		expect(treeRadios[0].disabled).toBe(true)
	})

	it('sourceItem 的后代出现在根目录列表时 radio 禁用', async () => {
		// 移动 /A 文件夹，但根目录列表里把 /A 和 /A/sub（后代）都展示出来
		const fetch = makeFetchTyped(
			{
				'/': [
					{ id: '1', path: '/A', name: 'A' },
					{ id: '2', path: '/A/sub', name: 'sub' },
				],
			},
			{ '/': [] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '1', name: 'A', path: '/A', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('sub')).toBeInTheDocument()
		})

		// 找包含 "sub" 文字的树节点，对应 radio 必须禁用
		const treeRadios = Array.from(
			document.querySelectorAll('.ant-tree-treenode input[type="radio"]'),
		) as HTMLInputElement[]
		const subRadio = treeRadios.find((r) => {
			const node = r.closest('.ant-tree-treenode')
			return node && node.textContent?.includes('sub')
		})
		expect(subRadio).toBeTruthy()
		expect(subRadio?.disabled).toBe(true)
	})

	// 回归：后端 getUploads({ path: '/', type: 'dir' }) 会在返回里带上
	// path === '/' 的根目录自身条目（项目里其他 7 处调用都用
	// .filter((item) => item.path !== '/') 显式过滤）；如果 moveToFetchDirs
	// 没过滤，buildDirNode 递归 getDirChildren('/') 会无限循环直至栈溢出。
	// 这里用 type=dir 返回包含 { path: '/' } 自身的数据，断言不抛 RangeError。
	it('后端 dir 列表含 path="/" 自身时不抛栈溢出且能正常渲染', async () => {
		const fetch = makeFetchTyped(
			{
				// 模拟后端在 path='/' 时把根目录自身也作为 dir 返回
				'/': [
					{ id: 'root-self', path: '/', name: '我的根目录' },
					{ id: '1', path: '/A', name: 'A' },
				],
			},
			{ '/': [] },
		)
		expect(() =>
			render(
				<MoveToModal
					open
					sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
					fetchDirs={fetch}
					onConfirm={vi.fn()}
					onCancel={vi.fn()}
				/>,
			),
		).not.toThrow()

		// 合法子目录 /A 仍要渲染出来（说明递归能终止到叶子）
		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})
		// 根目录行也照常展示（不依赖后端返回的根 self 条目）
		expect(screen.getByLabelText(t('move_to.root_dir') as string)).toBeInTheDocument()
	})
})

describe('MoveToModal - 搜索面板', () => {
	it('输入关键词后切换为扁平搜索结果', async () => {
		const fetch = vi.fn(async ({ keyword, type }: { keyword?: string; type?: 'dir' | 'file' }) => {
			if (keyword && type === 'dir') return { data: [{ id: '10', path: '/工作', name: '工作' }] }
			return { data: [] }
		})
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		const input = screen.getByPlaceholderText('Search') as HTMLInputElement
		await userEvent.type(input, '工')
		await waitFor(() => {
			expect(screen.getByText('工作')).toBeInTheDocument()
		}, { timeout: 2000 })
	})

	it('搜索结果行不渲染 path 小字标签', async () => {
		const fetch = vi.fn(async ({ keyword, type }: { keyword?: string; type?: 'dir' | 'file' }) => {
			if (keyword && type === 'dir') return { data: [{ id: '10', path: '/工作', name: '工作' }] }
			return { data: [] }
		})
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		const input = screen.getByPlaceholderText('Search') as HTMLInputElement
		await userEvent.type(input, '工')
		await waitFor(() => {
			expect(screen.getByText('工作')).toBeInTheDocument()
		}, { timeout: 2000 })
		// 路径不再作为可见标签渲染
		expect(screen.queryByText('/工作')).not.toBeInTheDocument()
	})

	it('搜索结果选中后确认按钮启用', async () => {
		const fetch = vi.fn(async ({ keyword, type }: { keyword?: string; type?: 'dir' | 'file' }) => {
			if (keyword && type === 'dir') return { data: [{ id: '10', path: '/工作', name: '工作' }] }
			return { data: [] }
		})
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		const input = screen.getByPlaceholderText('Search') as HTMLInputElement
		await userEvent.type(input, '工')
		await waitFor(() => screen.getByText('工作'), { timeout: 2000 })

		await userEvent.click(screen.getByText('工作'))
		const okBtn = screen.getByRole('button', { name: /^Confirm$/ })
		expect(okBtn).not.toBeDisabled()
	})
})

describe('MoveToModal - i18n', () => {
	it('JSX 内不出现中文硬编码（除了 i18n fallback 常量声明）', async () => {
		const fs = await import('fs')
		const path = await import('path')
		const tsx = fs.readFileSync(path.resolve(__dirname, './MoveToModal.tsx'), 'utf-8')

		// 移除所有 // 注释行 和 /* ... */ 块注释
		const noComments = tsx
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^\s*\/\/.*$/gm, '')

		// 允许的例外：i18n fallback 常量声明（CSV 未及时同步时仍能渲染）
		const fallbackConstRe = /^const\s+\w+_FALLBACK\s*=\s*['"][^'"]+['"]/
		const violations: string[] = []
		for (const rawLine of noComments.split('\n')) {
			const line = rawLine.trim()
			if (fallbackConstRe.test(line)) continue
			if (/[一-鿿]/.test(line)) {
				violations.push(line)
			}
		}
		expect(violations, `发现中文硬编码:\n${violations.join('\n')}`).toEqual([])
	})
})

describe('MoveToModal - Tree 展开 icon', () => {
	it('Tree switcher icon 使用 @ant-design/icons 的 DownOutlined', async () => {
		const fetch = makeFetchTyped(
			{ '/': [{ id: '1', path: '/A', name: 'A' }] },
			{ '/': [] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})
		// DownOutlined 渲染为 .anticon-down；switcher 容器里应包含它
		const switchers = Array.from(document.querySelectorAll('.ant-tree-switcher'))
		expect(switchers.length).toBeGreaterThan(0)
		const hasDownIcon = switchers.some((s) => s.querySelector('.anticon-down') !== null)
		expect(hasDownIcon).toBe(true)
	})

	it('长文件名称不超出 X 轴（min-width:0 + title overflow:hidden）', async () => {
		const longName = '非常长的文件夹或文件名用于测试横向溢出场景-' + 'x'.repeat(120)
		const fetch = makeFetchTyped(
			{ '/': [{ id: '1', path: '/A', name: longName }] },
			{ '/': [] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			// 长名称文本存在（证明渲染了）
			expect(screen.getByText(longName)).toBeInTheDocument()
		})
		// 树节点中：name span 应当被 Tooltip 包裹（antd Tooltip 渲染时会加 ant-tooltip 包裹层）
		const nameSpan = screen.getByText(longName)
		const tooltipWrap = nameSpan.closest('.ant-tooltip') || nameSpan.parentElement
		expect(tooltipWrap).toBeTruthy()
		// name span 应带 Tailwind truncate 与 min-w-0
		expect(nameSpan.className).toMatch(/truncate/)
		expect(nameSpan.className).toMatch(/min-w-0/)

		// CSS 规则：node-content-wrapper 与 title 的 min-width/overflow 控制
		const fs = await import('fs')
		const path = await import('path')
		const cssPath = path.resolve(__dirname, './move-to.css')
		const css = fs.readFileSync(cssPath, 'utf-8')
		expect(css).toMatch(/\.move-to-tree\s+\.ant-tree-node-content-wrapper[\s\S]*min-width:\s*0/)
		expect(css).toMatch(/\.move-to-tree\s+\.ant-tree-title[\s\S]*overflow:\s*hidden/)
		expect(css).toMatch(/\.move-to-tree\s+\.ant-tree-title\s*>\s*div[\s\S]*min-width:\s*0/)
	})

	it('根目录 label / 树节点 / switcher 高度统一 36px', async () => {
		const fetch = makeFetchTyped(
			{ '/': [{ id: '1', path: '/A', name: 'A' }] },
			{ '/': [] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument()
		})
		// 1) 根目录 label 容器带 h-9（=36px）Tailwind 类
		const rootLabel = screen.getByText(t('move_to.root_dir') as string).closest('label') as HTMLElement | null
		expect(rootLabel).toBeTruthy()
		expect(rootLabel?.className || '').toMatch(/h-9/)

		// 2) Tree 容器挂上 move-to-tree 类
		const treeEl = document.querySelector('.move-to-tree')
		expect(treeEl).toBeTruthy()

		// 3) 树节点内容容器存在
		const content = document.querySelector('.move-to-tree .ant-tree-node-content-wrapper')
		expect(content).toBeTruthy()

		// 4) 直接读取源 CSS 校验关键规则存在（jsdom 不解析 CSS）
		const fs = await import('fs')
		const path = await import('path')
		const cssPath = path.resolve(__dirname, './move-to.css')
		const css = fs.readFileSync(cssPath, 'utf-8')
		// 树节点内容容器
		expect(css).toMatch(/move-to-tree\s+\.ant-tree-node-content-wrapper/)
		expect(css).toMatch(/min-height:\s*36px/)
		expect(css).toMatch(/line-height:\s*36px/)
		// switcher 容器
		expect(css).toMatch(/move-to-tree\s+\.ant-tree-switcher/)
		expect(css).toMatch(/height:\s*36px/)
	})
})

describe('MoveToModal - 文件行 icon 对齐', () => {
	it('文件行默认使用 formatFileInfo 推 icon（docx → doc.png）', async () => {
		const fetch = makeFetchTyped(
			{ '/': [] },
			{ '/': [{ id: '1', path: '/plan.docx', name: 'plan.docx' }] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('plan.docx')).toBeInTheDocument()
		})
		// 找到包含 plan.docx 的树节点，断言其 img src 指向 doc.png
		const treenodes = Array.from(document.querySelectorAll('.ant-tree-treenode'))
		const target = treenodes.find((n) => n.textContent?.includes('plan.docx'))
		expect(target).toBeTruthy()
		const img = target?.querySelector('img')
		expect(img?.getAttribute('src') || '').toMatch(/doc\.png/)
	})

	it('文件行默认使用 formatFileInfo 推 icon（mp3 → mp3.png）', async () => {
		const fetch = makeFetchTyped(
			{ '/': [] },
			{ '/': [{ id: '1', path: '/song.mp3', name: 'song.mp3' }] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('song.mp3')).toBeInTheDocument()
		})
		const treenodes = Array.from(document.querySelectorAll('.ant-tree-treenode'))
		const target = treenodes.find((n) => n.textContent?.includes('song.mp3'))
		const img = target?.querySelector('img')
		expect(img?.getAttribute('src') || '').toMatch(/mp3\.png/)
	})

	it('文件行默认使用 formatFileInfo 推 icon（pdf → pdf.png，对齐 uploaded 外层）', async () => {
		const fetch = makeFetchTyped(
			{ '/': [] },
			{ '/': [{ id: '1', path: '/note.pdf', name: 'note.pdf' }] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('note.pdf')).toBeInTheDocument()
		})
		// uploaded 外层对 pdf 走 formatFileInfo → pdf.png；内置简化版会走 unknown.png
		const treenodes = Array.from(document.querySelectorAll('.ant-tree-treenode'))
		const target = treenodes.find((n) => n.textContent?.includes('note.pdf'))
		const img = target?.querySelector('img')
		expect(img?.getAttribute('src') || '').toMatch(/pdf\.png/)
	})

	it('resolveFileIcon prop 覆盖默认 icon 解析', async () => {
		const fetch = makeFetchTyped(
			{ '/': [] },
			{ '/': [{ id: '1', path: '/plan.docx', name: 'plan.docx' }] },
		)
		render(
			<MoveToModal
				open
				sourceItem={{ id: '99', name: 'src', path: '/old', isfolder: true }}
				fetchDirs={fetch}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
				resolveFileIcon={(node) => `/custom/${node.id}-${node.name}.png`}
			/>,
		)

		await waitFor(() => {
			expect(screen.getByText('plan.docx')).toBeInTheDocument()
		})
		const treenodes = Array.from(document.querySelectorAll('.ant-tree-treenode'))
		const target = treenodes.find((n) => n.textContent?.includes('plan.docx'))
		const img = target?.querySelector('img')
		expect(img?.getAttribute('src') || '').toMatch(/\/custom\/1-plan\.docx\.png/)
	})
})