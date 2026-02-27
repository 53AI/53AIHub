# 53AIHub 平台前端项目资源

<p align="center">53AIHub 平台以前后端分离的形式运行，此目录下均为前端源码，分别为站点前台`front`和管理后台`console`,可根据你的需要自由修改，分别构建。</p>

<p align="center">
<img src="https://img.shields.io/github/package-json/dependency-version/alex8088/electron-vite-boilerplate/dev/vite" alt="vite-version" />
<img src="https://img.shields.io/github/package-json/dependency-version/alex8088/electron-vite-boilerplate/dev/vue" alt="vue-version" />
<img src="https://img.shields.io/github/package-json/dependency-version/alex8088/electron-vite-boilerplate/dev/typescript" alt="typescript-version" />
</p>


## 目录结构

```
├── front     # 站点前台源代码目录
└── console   # 管理后台源代码目录
```

## 运行项目

### 本地版
先构建前端项目的前台和管理后台，再构建后端接口打包出可执行程序

进入目录
```bash
cd web/front
```
安装依赖
```bash
npm install
```

构建前台
```bash
npm run build
```
退出目录进入console目录
```bash
cd ../console
```
安装依赖
```bash
npm install
```
构建管理后台
```bash
npm run build
```
这样前端就构建完了，可以去看api目录的后端构建了（以下以打包windows为例）
```bash
cd ../../api
```
构建打包
```bash
make build-windows-cgo
```
在`api/bin`目录下已经生成了可执行exe，双击运行即可

TODO: 后续重构为 Monorepo，基于 pnpm workspace + Turborepo 构建，通用组件、工具函数会抽离出来
