import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth.js";
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
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
