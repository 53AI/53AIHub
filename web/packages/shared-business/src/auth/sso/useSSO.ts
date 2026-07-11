import { useEffect, useState } from "react";

interface SSOResult {
  token: string | null;
  isProcessing: boolean;
  error: string | null;
}

export function useSSO(): SSOResult {
  const [token, setToken] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ssoToken = urlParams.get("token");

    if (ssoToken) {
      // Validate and store token
      if (ssoToken.length > 0) {
        localStorage.setItem("access_token", ssoToken);
        setToken(ssoToken);
        // Clean up URL
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, "", cleanUrl);
      } else {
        setError("无效的 token");
      }
    }
    setIsProcessing(false);
  }, []);

  return { token, isProcessing, error };
}