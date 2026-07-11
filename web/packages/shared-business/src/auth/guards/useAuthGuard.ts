import { useState, useEffect } from "react";

interface AuthGuardResult {
  isLoggedIn: boolean;
  isLoading: boolean;
  token: string | null;
}

export function useAuthGuard(): AuthGuardResult {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem("access_token");
    const isValid = !!(storedToken && storedToken.length > 0);
    setToken(storedToken);
    setIsLoggedIn(isValid);
    setIsLoading(false);
  }, []);

  return { isLoggedIn, isLoading, token };
}