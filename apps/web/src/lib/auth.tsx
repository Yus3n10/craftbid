import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginInput, MeDto, RegisterInput } from "@craftbid/shared";
import { ApiError, api } from "./api.js";
import { BEARER_MODE, clearTokens, getRefreshToken, storeTokens } from "./session.js";

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

  /**
   * Becomes signed in only once the browser has proved it kept the session.
   *
   * This used to trust the user in the sign-in response. That response is
   * produced whether or not the browser went on to store the cookies that came
   * with it, so a browser that refused them showed a signed-in header and
   * menu, and the first page that needed the session answered 401: "My bids"
   * told someone who had just signed in that they needed to sign in. Asking
   * /auth/me, which only answers with the session, turns that silent false
   * state into a message at the moment it can still be acted on.
   *
   * Only a 401 means the session was not kept. Any other failure here (a
   * timeout, the API waking up) says nothing about the cookies, so the
   * response's own user is used rather than failing a sign-in that worked.
   *
   * storeTokens is a no-op for tokens in the web build, where the session
   * lives in httpOnly cookies the client cannot read.
   */
  async function establish(result: SessionResponse): Promise<MeDto> {
    storeTokens(result);
    try {
      const me = await api.get<MeDto>("/auth/me");
      queryClient.setQueryData(["me"], me);
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearTokens();
        throw new ApiError(401, {
          error: {
            code: "session_not_kept",
            message:
              "Your details were right, but this browser did not keep you signed in. Allow cookies for this site, or open it in your phone's browser, then try again.",
          },
        });
      }
      queryClient.setQueryData(["me"], result.user);
      return result.user;
    }
  }

  // The desktop build keeps its tokens in its own storage and has no
  // browser session to end, so it always asks for the lasting kind.
  const withRemember = <T extends { remember?: boolean }>(input: T): T =>
    BEARER_MODE ? { ...input, remember: true } : input;

  const loginMutation = useMutation({
    mutationFn: async (input: LoginInput) =>
      establish(await api.post<SessionResponse>("/auth/login", withRemember(input))),
  });

  const registerMutation = useMutation({
    mutationFn: async (input: RegisterInput) =>
      establish(await api.post<SessionResponse>("/auth/register", withRemember(input))),
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
    login: (input) => loginMutation.mutateAsync(input),
    register: (input) => registerMutation.mutateAsync(input),
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
