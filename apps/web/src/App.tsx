import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { UserRole } from "@craftbid/shared";
import { useAuth } from "./lib/auth.js";
import { Page, Shell } from "./components/layout/Shell.js";
import { CardSkeleton, EmptyState, RowSkeleton } from "./components/ui/States.js";

/**
 * Routes are code-split.
 *
 * The audience is largely on Philippine mobile data, where the difference
 * between shipping the whole application and shipping the one screen someone
 * asked for is paid in seconds on the first load. The landing page in
 * particular should not carry the settings form or the bid comparison screen.
 */
const HomePage = lazy(async () => ({ default: (await import("./pages/HomePage.js")).HomePage }));
const LoginPage = lazy(async () => ({ default: (await import("./pages/LoginPage.js")).LoginPage }));
const RegisterPage = lazy(async () => ({ default: (await import("./pages/RegisterPage.js")).RegisterPage }));
const PostingsPage = lazy(async () => ({ default: (await import("./pages/PostingsPage.js")).PostingsPage }));
const PostingDetailPage = lazy(async () => ({ default: (await import("./pages/PostingDetailPage.js")).PostingDetailPage }));
const PostingFormPage = lazy(async () => ({ default: (await import("./pages/PostingFormPage.js")).PostingFormPage }));
const PostingApplicationsPage = lazy(async () => ({ default: (await import("./pages/PostingApplicationsPage.js")).PostingApplicationsPage }));
const DiscoverPage = lazy(async () => ({ default: (await import("./pages/DiscoverPage.js")).DiscoverPage }));
const SearchPage = lazy(async () => ({ default: (await import("./pages/SearchPage.js")).SearchPage }));
const PostDetailPage = lazy(async () => ({ default: (await import("./pages/PostDetailPage.js")).PostDetailPage }));
const ProfilePage = lazy(async () => ({ default: (await import("./pages/ProfilePage.js")).ProfilePage }));
const PostFormPage = lazy(async () => ({ default: (await import("./pages/PostFormPage.js")).PostFormPage }));
const MyPostingsPage = lazy(async () => ({ default: (await import("./pages/MyPostingsPage.js")).MyPostingsPage }));
const MyApplicationsPage = lazy(async () => ({ default: (await import("./pages/MyApplicationsPage.js")).MyApplicationsPage }));
const CommissionsPage = lazy(async () => ({ default: (await import("./pages/CommissionsPage.js")).CommissionsPage }));
const CommissionDetailPage = lazy(async () => ({ default: (await import("./pages/CommissionDetailPage.js")).CommissionDetailPage }));
const NotificationsPage = lazy(async () => ({ default: (await import("./pages/NotificationsPage.js")).NotificationsPage }));
const SettingsPage = lazy(async () => ({ default: (await import("./pages/SettingsPage.js")).SettingsPage }));

/** Shown while a route chunk is still arriving. */
function RouteFallback() {
  return (
    <Page>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton count={3} />
      </div>
    </Page>
  );
}

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
    <Suspense fallback={<RouteFallback />}>
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
        <Route path="search" element={<SearchPage />} />
        <Route path="artists/:username" element={<ProfilePage />} />
        <Route
          path="posts/new"
          element={
            <RequireAuth role="artist">
              <PostFormPage />
            </RequireAuth>
          }
        />
        <Route path="posts/:id" element={<PostDetailPage />} />
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
    </Suspense>
  );
}
