# KM Mobile

移动端 React (Expo) 应用，可编译为 iOS/Android App，与 monorepo 内 `shared-utils`、`shared-public` 复用。

**开发规范**：见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。根目录 Cursor 规则 [.cursor/rules/mobile.mdc](../../.cursor/rules/mobile.mdc) 在编辑 `apps/mobile` 时适用。

## 文档

- [React Native 官方文档](https://reactnative.dev/docs/getting-started)（组件、API、样式、导航等）
- [Expo 文档](https://docs.expo.dev/)（Expo SDK、配置、构建、EAS）
- [Expo Router 文档](https://docs.expo.dev/router/introduction/)（文件路由、布局、链接）
- [NativeWind 文档](https://www.nativewind.dev/)（Tailwind 在 React Native 中的用法）

## 复用 shared 包

### @km/shared-utils

- **仅使用通用入口**：`import { ... } from '@km/shared-utils/universal'`
- 主入口 `@km/shared-utils` 依赖浏览器/DOM，在 React Native 中不可用。
- `universal` 子路径仅导出不依赖 `document`/`window`/`navigator` 的模块（如 moment、debounce、md5、event-bus、date-range、is、object、string、id、time、unique-name、short-id、url 的 isUrl/joinUrl、base64 字符串/字节、async 的 sleep 等）。

### @km/shared-public

- 静态资源（icons、images 等）通过 **Metro 配置** 解析。
- `metro.config.js` 中已配置 `watchFolders` 与 `resolver.extraNodeModules`，将 `@km/shared-public` 指向 `packages/shared-public`。
- 引用方式示例：`require('@km/shared-public/icons/xxx.png')` 或使用路径别名（需在 Metro/Babel 中配置）。
- UEditor 等 Web 专用资源无需在移动端使用，仅复用 icons、images 即可。

## 脚本

- `pnpm dev` / `pnpm start`：启动 Expo 开发服务器
- `pnpm android`：Android 模拟器/设备
- `pnpm ios`：iOS 模拟器（仅 macOS）
- `pnpm web`：Web 预览
- `pnpm build`：`expo export` 导出
- `pnpm type-check`：TypeScript 检查

## 根目录快捷命令

- 在 monorepo 根目录执行 `pnpm dev:mobile`、`pnpm build:mobile` 即可对该应用进行开发与构建。

## 依赖与构建顺序

- 移动端依赖 `@km/shared-utils`，需先执行根目录 `pnpm build:shared`（或由 turbo 的 `^build` 保证 shared 先构建），再在 `apps/mobile` 内执行 `pnpm build` 或 `expo export`。
- `@km/shared-public` 无需构建，仅通过 Metro 解析路径。
