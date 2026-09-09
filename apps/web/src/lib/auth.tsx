import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginInput, MeDto, RegisterInput } from "@raxtan/shared";
import { ApiError, api } from "./api.js";
import { clearTokens, getRefreshToken, storeTokens } from "./session.js";

/** The shape both /auth/login and /auth/register return. */
interface SessionResponse {
  user: MeDto;
  accessToken: string;
  refreshToken: string;
}

interface AuthValue {
  user: MeDto | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<MeDto>;
  register: (input: RegisterInput) => Promise<MeDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<MeDto>("/auth/me");
      } catch (error) {
        // Signed out is the expected state for a first-time visitor, not a
        // failure worth retrying or surfacing.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  // storeTokens is a no-op in the web build, where the session lives in
  // httpOnly cookies the client cannot read.
  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<SessionResponse>("/auth/login", input),
    onSuccess: (result) => {
      storeTokens(result);
      queryClient.setQueryData(["me"], result.user);
    },
  });

  const registerMutation = useMutation({
    mutationFn: (input: RegisterInput) =>
      api.post<SessionResponse>("/auth/register", input),
    onSuccess: (result) => {
      storeTokens(result);
      queryClient.setQueryData(["me"], result.user);
    },
  });

  const logoutMutation = useMutation({
    // Sends the refresh token so the desktop build's session is revoked
    // server-side; in the web build this is an empty object and the cookie
    // does the work.
    mutationFn: () =>
      api.post<void>("/auth/logout", {
        refreshToken: getRefreshToken() ?? undefined,
      }),
    onSuccess: () => {
      clearTokens();
      queryClient.setQueryData(["me"], null);
      // Anything cached could be another user's view of the same route.
      queryClient.clear();
    },
  });

  const value: AuthValue = {
    user: data ?? null,
    isLoading,
    login: async (input) => (await loginMutation.mutateAsync(input)).user,
    register: async (input) => (await registerMutation.mutateAsync(input)).user,
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
