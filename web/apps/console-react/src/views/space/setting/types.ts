import type { RefObject } from "react";

/** 空间设置 drawer 中的 tab key */
export type SpaceSettingTabKey =
  | "basic-info"
  | "members"
  | "knowledge";

/** 需要底部「取消/保存」的 tab key（成员 / 知识库管理 不在 drawer 底部渲染保存按钮） */
export const SPACE_SETTING_FOOTER_TAB_KEYS: SpaceSettingTabKey[] = [
  "basic-info",
];

export interface TabState {
  dirty: boolean;
  saving: boolean;
}

export type TabStateChangeHandler = (state: TabState) => void;

/**
 * 需要底部「取消/保存」的 tab 通过 ref 暴露给 drawer 的能力。
 * drawer footer 直接调用 save / reset，按钮的启用/loading 状态由 tab 通过
 * onStateChange 回调上报，由 drawer 集中维护。
 */
export interface TabActionsRef {
  /** 提交本地修改，返回 true 表示保存成功 */
  save: () => Promise<boolean>;
  /** drawer 在切换 tab 时主动拉取当前 tab 的状态 */
  getState: () => TabState;
}

export type TabActionsRefObject = RefObject<TabActionsRef>;
