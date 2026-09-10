import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { App } from "./App.js";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Marketplace data changes under you: another artist bids, a client
      // picks someone. Refetching on focus keeps a stale tab from misleading.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Retrying a 404 or a 403 just delays the error state.
        //
        // 408 is the exception, and it is ours: the client raises it when a
        // request outlives its deadline. That is exactly the case worth
        // retrying, because the usual reason is the API waking from Render's
        // idle stop, and the attempt that timed out is what started it waking.
        const status = (error as { status?: number }).status;
        if (status && status !== 408 && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// The outer boundary is the backstop for a failure above the router, where
// Shell's own boundary cannot reach: the providers themselves, or the entry
// chunk. Without one, anything thrown here leaves an empty document.
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="the app">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
