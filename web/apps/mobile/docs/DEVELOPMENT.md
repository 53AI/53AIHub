# KM Mobile 开发规范

本文档定义 `apps/mobile`（Expo + React Native）的开发规范，与 monorepo 根目录的 `.cursor/rules` 及 `AGENTS.md` 互补；涉及 TypeScript、样式、状态、路由等均以本文为准。

---

## 1. 技术栈与目录约定

### 1.1 技术栈

- **框架**：Expo SDK 52、React 18、React Native
- **路由**：Expo Router 4（基于文件的路由，`app/` 目录）
- **状态**：Zustand
- **样式**：NativeWind（Tailwind for React Native），辅以 `StyleSheet` 仅当必要
- **语言**：TypeScript（严格模式）
- **共享**：`@km/shared-utils/universal`、`@km/shared-public`（静态资源）

### 1.2 目录结构

```
apps/mobile/
├── app/                    # 路由页面（Expo Router）
│   ├── _layout.tsx         # 根布局
│   ├── index.tsx           # 首页
│   └── *.tsx               # 其他路由
├── store/                  # Zustand stores
│   └── *.ts
├── components/             # 可复用 UI 组件（可选）
├── hooks/                  # 自定义 hooks（可选）
├── constants/              # 常量、枚举（可选）
├── docs/                   # 文档（本文档等）
├── global.css              # NativeWind 入口
├── tailwind.config.js
├── metro.config.js
├── babel.config.js
├── app.json
├── package.json
└── tsconfig.json
```

- **页面**：只放在 `app/` 下，通过文件命名生成路由。
- **业务状态**：放在 `store/`，按领域或功能拆分（如 `todoStore.ts`）。
- **可复用 UI**：放在 `components/`，按功能分子目录（如 `components/Button/`）。
- **类型**：优先与模块同目录（如 `store/todoStore.ts` 内导出 `TodoItem`），或集中放在 `types/`。

---

## 2. 命名规范

### 2.1 文件与组件

- **路由文件**：小写 + 连字符，如 `app/todo.tsx`、`app/user-profile.tsx`；目录用 `_layout.tsx` 表示布局。
- **组件/页面**：默认导出使用 PascalCase，与路由或组件用途一致，如 `export default function TodoScreen()`。
- **Store**：`*Store.ts`，如 `todoStore.ts`；hook 以 `use` 开头，如 `useTodoStore`。
- **Hooks**：`use*.ts`，如 `useDebounce.ts`。

### 2.2 变量与类型

- **组件 / 类型**：PascalCase。
- **变量、函数、方法**：camelCase。
- **常量**：全大写下划线或 camelCase 视语境而定；枚举用 `const` 对象 + `as const`，避免 `enum`。
- **布尔**：前缀 `is` / `has` / `should`，如 `isLoading`、`hasError`。

---

## 3. TypeScript

### 3.1 通用原则

- 优先使用 **`type`** 定义对象形状；必要时再用 `interface`。
- 避免 **`any`**；用 `unknown` 或具体类型，必要时再断言。
- 函数、API 返回、Store 状态均需**显式类型**；组件 Props 用 `type` 定义。

### 3.2 与项目规范对齐

- 与根目录 `.cursor/rules/typescript.mdc` 保持一致：类型优先、禁止 any、使用 `type`、枚举用 `const` 对象等。
- 在 React Native 中，事件参数使用 `GestureResponderEvent` 等 RN 类型；路由参数使用 Expo Router 提供的类型。

### 3.3 示例

```ts
// store 状态与类型
export type TodoItem = {
  id: string
  title: string
  done: boolean
}

type TodoState = {
  items: TodoItem[]
  addTodo: (title: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
}

export const useTodoStore = create<TodoState>((set) => ({ ... }))
```

---

## 4. 共享包使用

### 4.1 @km/shared-utils

- **仅使用通用入口**：`import { ... } from '@km/shared-utils/universal'`。
- **禁止**：`import ... from '@km/shared-utils'`（主入口依赖 DOM，在 RN 中会报错）。
- 可用能力包括：时间（moment）、URL（isUrl、joinUrl）、格式化（formatFileSize）、ID（generateRandomId、generateUUID）、防抖、MD5、事件总线、base64 字符串/字节、sleep 等；不可使用 copy、file 下载、scroll、cache（cookie）等依赖浏览器的 API。

### 4.2 @km/shared-public

- **图片**：`require('@km/shared-public/images/...')` 或 `require('@km/shared-public/icons/xxx.png')`，与 `<Image source={...} />` 配合。
- **SVG**：在配置好 `react-native-svg-transformer` 的前提下，`require('@km/shared-public/icons/xxx.svg').default` 作为组件使用。
- UEditor 等 Web 专用资源不在移动端使用。

---

## 5. 样式（NativeWind + StyleSheet）

### 5.1 优先级

1. **NativeWind**：优先用 `className` 写 Tailwind 类名（与项目 Tailwind 规范一致，移动优先、语义化间距）。
2. **StyleSheet**：仅在 NativeWind 难以表达或需要动态样式时使用（如 `style={[styles.x, { width: w }]}`）。

### 5.2 约定

- 布局、间距、颜色、字号等尽量用 `className`；复杂动画或平台差异可用 `StyleSheet`。
- 不混用无意义的重复定义：同一处样式只在一处写（要么 className，要么 style）。
- 响应式：以移动端为基准，必要时用 `className` 的断点（如 `md:`）或条件样式。

### 5.3 示例

```tsx
<View className="flex-1 bg-white items-center justify-center p-6">
  <Text className="text-xl mb-6">{greeting}</Text>
  <Image source={logo} style={{ width: 128, height: 64 }} />
</View>
```

---

## 6. 状态管理（Zustand）

- 按功能/领域拆分 store 文件，如 `todoStore.ts`、`userStore.ts`。
- 每个 store 用 `create<TState>()` 并导出 `useXxxStore`；状态与 actions 同处一个 slice，避免分散。
- 在组件内按需解构，减少重渲染：`const { items, addTodo } = useTodoStore()`；若 store 较大，可用选择器。

---

## 7. 路由（Expo Router）

- 页面与布局均放在 `app/` 下；新页面即新建 `app/xxx.tsx` 或 `app/xxx/index.tsx`。
- 跳转使用 `<Link href="/path">` 或 `router.push('/path')`；参数与 404 等遵循 Expo Router 约定。
- 根布局 `_layout.tsx` 中统一配置 Stack/Tabs、主题、StatusBar；子目录可再放 `_layout.tsx` 做嵌套布局。

---

## 8. 资源与静态文件

- **shared-public**：通过 `@km/shared-public` 引用 icons、images，见上文。
- **本地资源**：放在 `assets/`，通过相对路径或 `require('./assets/...')` 引用。
- **SVG**：依赖 `react-native-svg` + `react-native-svg-transformer`；仅对来自 shared-public 或本地的 SVG 使用 transformer，避免与 NativeWind 的 Metro 配置冲突。

---

## 9. 脚本与构建

- 开发：`pnpm dev` / `pnpm start`；Web：`pnpm web`；根目录：`pnpm dev:mobile`、`pnpm dev:mobile:web`。
- 构建前先执行根目录 `pnpm build:shared`，再在 `apps/mobile` 内 `pnpm build`（expo export）。
- 类型检查：`pnpm type-check`（当前使用 `--skipLibCheck` 规避依赖 .d.ts 问题）。

---

## 10. 代码质量与提交

- 与根目录规范一致：先描述方案再实现、单次修改文件不宜过多、修复 bug 时先写可重现用例再修。
- 提交信息使用中文；功能/修复/重构等含义清晰。
- 新增页面或 store 时，在本文档或 README 中补充说明（若影响整体结构或共享包用法）。

---

## 11. 检查清单（提交前）

- [ ] 仅从 `@km/shared-utils/universal` 引用工具，未使用主入口。
- [ ] 新页面在 `app/` 下，命名与路由一致。
- [ ] 类型完整（无 any、函数与 Store 有显式类型）。
- [ ] 样式以 NativeWind 为主，StyleSheet 仅作补充。
- [ ] 已运行 `pnpm type-check`（若可用）。
- [ ] 已在真机或 Web 上简单自测。

---

以上为 KM Mobile 开发规范，与 monorepo 内其他规则（如 `.cursor/rules/agent.mdc`、`typescript.mdc`）一起使用；在 mobile 范围内的开发以本文档为准。
