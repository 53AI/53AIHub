import { useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { useUserStore } from "@/stores/modules/user"

export function SsoLoginView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const sso_login = useUserStore((state) => state.sso_login)

  useEffect(() => {
    const query = {
      sign: searchParams.get("sign") || "",
      timestamp: searchParams.get("timestamp") || "",
      username: searchParams.get("username") || "",
    }
    sso_login(query).then(() => {
      navigate("/", { replace: true })
    })
  }, [searchParams, sso_login, navigate])

  return null
}
