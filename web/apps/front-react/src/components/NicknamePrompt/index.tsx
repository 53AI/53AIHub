import { useEffect, useRef, useState } from "react";
import { useUserStore } from "@/stores/modules/user";
import { EditProfileModal } from "@/components/EditProfileModal";
import {
  isOpenidLikeNickname,
  markNicknamePrompted,
  shouldPromptNicknameFix,
} from "@/utils/nickname-prompt";
import { isWecomBrowser } from "@/utils/browser-env";
import { t } from "@/locales";

/** users/me 返回后延迟多久弹窗，避免和登录成功提示/页面跳转打架 */
const PROMPT_DELAY = 6000;

/**
 * 登录后昵称异常引导。
 *
 * 时机：users/me 返回、用户信息落到 store 之后（不依赖 LOGIN_SUCCESS 事件，
 * 因为刷新页面复用 token 时不会 emit）。
 * 条件：企业微信内置浏览器 + 昵称像 openid + 7 天内未提示过。
 * 行为：6s 后弹「编辑个人信息」。
 */
export function NicknamePrompt() {
  const nickname = useUserStore((state) => state.info.nickname);
  const isLogin = useUserStore((state) => state.is_login);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number>();
  // 本次登录会话内只判定一次，避免用户关掉后又被重新排期
  const handledRef = useRef(false);

  useEffect(() => {
    if (!isLogin || !nickname) return;
    if (handledRef.current) return;
    // 只在企业微信内置浏览器里提示（openid 昵称只可能来自企微登录）
    if (!isWecomBrowser()) return;
    if (!shouldPromptNicknameFix(nickname)) return;

    handledRef.current = true;
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      markNicknamePrompted(nickname);
    }, PROMPT_DELAY);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [isLogin, nickname]);

  // 退出登录后重置，下次登录重新判定
  useEffect(() => {
    if (!isLogin) handledRef.current = false;
  }, [isLogin]);

  const handleClose = () => setOpen(false);

  const handleSuccess = () => {
    setOpen(false);
    // 改完仍像 openid（用户自己填了长串字母数字）就不再打扰
    handledRef.current = true;
  };

  return (
    <EditProfileModal
      open={open}
      onClose={handleClose}
      onSuccess={handleSuccess}
      title={t("nickname_fix.title")}
      alertText={t("nickname_fix.desc")}
    />
  );
}

/** 供外部主动触发（例如设置页「修改昵称」）时判断是否仍是异常昵称 */
export { isOpenidLikeNickname };

export default NicknamePrompt;
