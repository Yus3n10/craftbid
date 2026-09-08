import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { UserRole } from "@raxtan/shared";
import { useAuth } from "./lib/auth.js";
import { Page, Shell } from "./components/layout/Shell.js";
import { EmptyState, RowSkeleton } from "./components/ui/States.js";

import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { PostingsPage } from "./pages/PostingsPage.js";
import { PostingDetailPage } from "./pages/PostingDetailPage.js";
import { PostingFormPage } from "./pages/PostingFormPage.js";
import { PostingApplicationsPage } from "./pages/PostingApplicationsPage.js";
import { DiscoverPage } from "./pages/DiscoverPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { PostFormPage } from "./pages/PostFormPage.js";
import { MyPostingsPage } from "./pages/MyPostingsPage.js";
import { MyApplicationsPage } from "./pages/MyApplicationsPage.js";
import { CommissionsPage } from "./pages/CommissionsPage.js";
import { CommissionDetailPage } from "./pages/CommissionDetailPage.js";
import { NotificationsPage } from "./pages/NotificationsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

/**
 * Route guards are a convenience, not a control. Every one of these routes is
 * also enforced on the server, which re-derives the caller's identity from
 * their token and re-checks ownership against the database. Hiding a link has
 * never stopped anyone from calling an endpoint.
 */
function RequireAuth({
  role,
  children,
}: {
  role?: UserRole;
  children: ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Page>
        <div className="space-y-3">
          <RowSkeleton count={3} />
        </div>
      </Page>
    );
  }

  if (!user) {
    // Remember where they were headed so signing in returns them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && user.role !== role) {
    return (
      <Page>
        <EmptyState
          title={
            role === "client"
              ? "This is a client action"
              : "This is an artist action"
          }
          description={
            role === "client"
              ? "You are signed in as an artist. Client accounts post craft requests and choose who makes them."
              : "You are signed in as a client. Artist accounts build a portfolio and bid on requests."
          }
          action={{ label: "Back to requests", to: "/postings" }}
        />
      </Page>
    );
  }

  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route path="postings" element={<PostingsPage />} />
        <Route
          path="postings/new"
          element={
            <RequireAuth role="client">
              <PostingFormPage />
            </RequireAuth>
          }
        />
        <Route path="postings/:id" element={<PostingDetailPage />} />
        <Route
          path="postings/:id/edit"
          element={
            <RequireAuth role="client">
              <PostingFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="postings/:id/applications"
          element={
            <RequireAuth role="client">
              <PostingApplicationsPage />
            </RequireAuth>
          }
        />

        <Route path="discover" element={<DiscoverPage />} />
        <Route path="artists/:username" element={<ProfilePage />} />
        <Route
          path="posts/new"
          element={
            <RequireAuth role="artist">
              <PostFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="posts/:id/edit"
          element={
            <RequireAuth role="artist">
              <PostFormPage />
            </RequireAuth>
          }
        />

        <Route
          path="my/postings"
          element={
            <RequireAuth role="client">
              <MyPostingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="my/applications"
          element={
            <RequireAuth role="artist">
              <MyApplicationsPage />
            </RequireAuth>
          }
        />

        <Route
          path="commissions"
          element={
            <RequireAuth>
              <CommissionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="commissions/:id"
          element={
            <RequireAuth>
              <CommissionDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />

        <Route
          path="*"
          element={
            <Page>
              <EmptyState
                title="That page does not exist"
                description="The link may be out of date, or the item was removed by its owner."
                action={{ label: "Browse craft requests", to: "/postings" }}
              />
            </Page>
          }
        />
      </Route>
    </Routes>
  );
}
