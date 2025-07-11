# 管理后台前端项目

基于 Vue3 和 TypeScript 的AI代理管理平台管理后台开发模板

## 特性

\- 💡 优化的资源处理

\- 🚀 快速的热模块替换（HMR）

\- 🔌 便捷的调试体验

\- 📦 完善的构建流程

## 开发环境配置

### 推荐的 IDE 配置

\- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin)

## 项目设置

### Node 版本要求

v18.12.0

### 安装依赖

```bash
$ npm install
```

### 开发模式

```bash
$ npm run dev
```

### 构建项目

```bash
$ npm run build
```

### 服务端后台代码更新
复制`dist/`文件夹下的所有代码， 粘贴到`api/static/dist`文件夹中


### 百度编辑器相关

如有附件上传相关的操作，请在 `public\UEditor\third-party\webuploader\webuploader.min.js` 中修改`oss-api-key` 和 `oss-url.cn`


## 技术文档

- [项目配置](https://cn.vitejs.dev/config/)
- [Vue3 文档](https://cn.vuejs.org/)
- [TypeScript 文档](https://www.typescriptlang.org/zh/)
- [Vite 指南](https://cn.vitejs.dev/guide/)

## 代码规范

本项目使用 ESLint 和 Prettier 来确保代码质量和一致性。请确保在提交代码前运行代码检查：

```bash
$ npm run lint
```

## 目录结构

```
├── src/src     # 源代码目录
│   ├── api/              # api接口与错误code
│   ├── assets/           # 样式跟icon
│   ├── components/       # 组件
│   ├── directive/        # 自定义指令
│   ├── views/            # 页面
│   ├── router/           # 路由配置
│   ├── typings/          # 类型定义
│   ├── constants/        # 常用变量
│   ├── locales/          # 语言包
│   ├── store/            # 状态管理
│   ├── utils/            # 工具箱
│   └── main.ts           # 入口文件
├── src/renderer/public   # 公共资源
├── dist/                 # 构建输出目录
├── .eslintrc.js          # ESLint 配置
├── .prettierrc           # Prettier 配置
├── tsconfig.json         # TypeScript 配置
└── vite.config.ts        # Vite 配置
```
