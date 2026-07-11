import { Button, App } from "antd";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";

export function NotFound() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const messageShown = useRef(false);

  const goHome = () => {
    navigate("/");
  };

  useEffect(() => {
    if (messageShown.current) return;
    messageShown.current = true;

    const hide = message.warning({
      content: t("no_permission_tip"),
      duration: 2,
    });

    return () => {
      hide?.();
    };
  }, [message]);

  return (
    <div className="flex w-full h-full">
      <div className="px-4 m-auto space-y-4 text-center max-w-[400px]">
        <h1 className="text-xl text-slate-800 dark:text-neutral-200">
          {t("not_found_tip")}
        </h1>

        <div className="flex items-center justify-center text-center">
          <div className="w-[300px]">
            <SvgIcon name="404" width="300px" height="225px" />
          </div>
        </div>
        <Button type="primary" onClick={goHome}>
          {t("go_home")}
        </Button>
      </div>
    </div>
  );
}

export default NotFound;
