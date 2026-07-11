
hooks 迁移已按 plan 做完，摘要如下。

---

## 1. 已迁移的 Hooks（`apps/console-react/src/hooks`）

| Hook | 说明 |
|------|------|
| **useEnv** | 沿用现有 `@/layout/useEnv` 的再导出，未改。 |
| **useTooltip** | 用 `useState` + `useEffect` 做“点击非浮层关闭”，返回 `{ tooltipVisible, setTooltipVisible }`。 |
| **useScroll** | 用 `useRef` + `useCallback`，`nextTick` 用 `queueMicrotask`。返回 `scrollRef`、`scrollToBottom`、`scrollToTop`、`scrollTo`、`scrollToVal`、`scrollToBottomIfAtBottom`。 |
| **useBasicLayout** | 用 `useSyncExternalStore` + `window.matchMedia` 做 sm/md/lg/xl；`isInMobile` / `isInDingTalk` 用 `useMemo` + `navigator.userAgent`。 |
| **useVmodel** | 受控用法：`[value, setValue]`，`setValue` 只调 `onChange`。 |
| **useSso** | `useState` 存 `syncValue`，`loadSyncSetting` / `saveSyncSetting` 用 `useSettingStore` 与 `cacheManager`；依赖的 **useSettingStore** 在 `@/layout/stores` 中做了占位（`get` / `save`）。 |
| **useMobile** | `useState` 表单项 + 倒计时 `setInterval`，`handleSendCode` 用 `@/directive/debounce` 调 `post('/api/sms/sendcode')`，成功用 AntD `message.success`。 |
| **useOfficeViewer** | `useState` 存 `officeType` / `wpsStatus` / `officeLoading`，`checkOfficeViewer`、`getOfficeViewerSetting` 内直接用 `service.get` 与 `cacheManager`，无独立 setting/platform-settings 模块。 |
| **useEntityInfo** | 逻辑与 console 对齐：`getCachedEntities`、全量/单条/批量用户与群组、清缓存；**useUserStore** 在顶层调用，并在 `@/layout/stores` 中增加 `loadListData` 占位（返回 `{ list: [] }`）。 |

## 2. 新增/改动的支撑文件

- **`src/types/entity.ts`**：实体类型（`ENTITY_TYPE`、`UserInfo`、`GroupInfo`、`EntityInfo`、`EntityCacheConfig` 等）。
- **`src/api/modules/user.ts`**：仅保留 `INTERNAL_USER_STATUS_ALL` 与 `userApi.fetch_internal_user`，供 useEntityInfo 用。
- **`src/api/modules/group.ts`**：仅保留 `groupApi.list`（按 `GROUP_TYPE.INTERNAL_USER`），供 useEntityInfo 用。
- **`src/layout/stores.ts`**：
  - 增加 **useSettingStore** 占位（`get` / `save`）；
  - **EnterpriseInfo** 增加 `is_install_wecom` / `is_install_dingtalk`；
  - **useUserStore** 增加 `loadListData` 占位。

## 3. 统一导出

- **`src/hooks/index.ts`**：导出上述所有 hooks 及用到的类型（如 `UseTooltipReturn`、`UseScrollReturn`、`SyncValueState`、`MobileForm`、`MobileRules`、`OfficeViewerType`、`ShowType`、`WpsStatus`、`UseOfficeViewerReturn`）。

## 4. 使用方式

- 从 `@/hooks` 按需引入，例如：
  `import { useScroll, useEntityInfo } from '@/hooks'`

Hooks 迁移的 todo（含 useSso / useMobile / useOfficeViewer / useEntityInfo）已全部标为完成；plan 里下一步是 **stores 迁移**（用 Zustand/Context 实现与 console 同名的 useXxxStore）。需要的话我可以按 plan 继续做 stores 迁移。
