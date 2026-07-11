import { useEffect, useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { CreateNewEnterprise } from "./components/CreateNewEnterprise";
import { EnterpriseList } from "./components/EnterpriseList";
import { ForgetForm } from "./components/ForgetForm";
import { getRealPath } from "@/utils/config";

const FORM_TYPE = {
  LOGIN: "login",
  APPLY: "apply",
  FORGET: "forget",
  LIST: "list",
} as const;

type FormType = (typeof FORM_TYPE)[keyof typeof FORM_TYPE];

export function LoginPage() {
  const [formType, setFormType] = useState<FormType>(FORM_TYPE.LOGIN);
  const [prevFormType, setPrevFormType] = useState<FormType>(FORM_TYPE.LOGIN);

  // 初始化：检查是否有登录类型标记
  useEffect(() => {
    if (localStorage.getItem("login_type") === "apply") {
      setFormType(FORM_TYPE.APPLY);
    }
  }, []);

  const openApply = () => {
    setPrevFormType(formType);
    setFormType(FORM_TYPE.APPLY);
  };

  const openForget = () => {
    setPrevFormType(formType);
    setFormType(FORM_TYPE.FORGET);
  };

  const openLogin = () => {
    setPrevFormType(formType);
    setFormType(FORM_TYPE.LOGIN);
  };

  const openList = () => {
    setPrevFormType(formType);
    setFormType(FORM_TYPE.LIST);
  };

  const openRegister = () => {
    setPrevFormType(formType);
    setFormType(FORM_TYPE.APPLY);
  };

  const handleBack = () => {
    setFormType(prevFormType);
  };

  return (
    <div className="w-screen h-screen bg-white flex">
      <div
        className="relative w-[55%] bg-cover bg-center bg-no-repeat max-md:hidden"
        style={{ backgroundImage: `url('${getRealPath("/images/login/km-bg.png")}')` }}
      >
        <img
          className="h-10 object-contain absolute top-8 left-10"
          src={getRealPath("/images/km-logo.png")}
          alt=""
        />
        <img
          className="w-[48%] object-contain absolute top-[25%] left-1/2 -translate-x-1/2"
          src={getRealPath("/images/login/km-title-new.png")}
          alt=""
        />
        <img
          className="w-[75%] object-contain absolute top-[32%] left-1/2 -translate-x-1/2"
          src={getRealPath("/images/login/km-demo-new.png")}
          alt=""
        />
      </div>

      <div className="flex-1 relative flex flex-col justify-center items-center pt-10 px-6 box-border overflow-auto">
        {formType === FORM_TYPE.LOGIN && (
          <LoginForm
            onForget={openForget}
            onApply={openApply}
            onList={openList}
            onLogin={openLogin}
          />
        )}
        {formType === FORM_TYPE.APPLY && (
          <CreateNewEnterprise onLogin={openLogin} onList={openList} />
        )}
        {formType === FORM_TYPE.LIST && (
          <EnterpriseList
            onApply={(username) => {
              openApply();
            }}
            onBack={handleBack}
          />
        )}
        {formType === FORM_TYPE.FORGET && (
          <ForgetForm onLogin={openLogin} onRegister={openRegister} />
        )}
      </div>
    </div>
  );
}
