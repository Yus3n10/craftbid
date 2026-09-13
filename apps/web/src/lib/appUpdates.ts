/**
 * Picking up a new deploy on the first visit after it, not the second.
 *
 * The service worker answers every page load from its precache, so the first
 * visit after a deploy runs the previous build while the new worker installs
 * behind it. `autoUpdate` activates that worker at once, but the page already
 * on screen keeps the old code until something reloads it. Found in use: an
 * artist opened Settings the day payment details shipped and the section was
 * not there, because the page was the build from before.
 *
 * The injected registerSW.js only registers the worker and never reloads, so
 * this watches for the moment a new worker takes control and reloads at the
 * first moment that cannot cost anyone their input:
 *
 * - straight away, if nobody has touched the page yet (the usual case: the
 *   new worker takes over a second or two after the page opens);
 * - otherwise on the next change of page, which leaves the current one anyway.
 *
 * Never on returning to the tab. Switching to GCash to copy a reference number
 * and coming back is exactly when a half-filled payment form is on screen.
 */
let updateWaiting = false;

export function watchForAppUpdates(): void {
  if (!("serviceWorker" in navigator)) return;

  // A page that loaded with no worker is already the current build; the
  // worker claiming it for the first time is an install, not an update.
  let controlled = navigator.serviceWorker.controller !== null;
  let touched = false;
  const markTouched = () => {
    touched = true;
  };
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, markTouched, { capture: true, once: true, passive: true });
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (touched) updateWaiting = true;
    else window.location.reload();
  });
}

/** Called on every change of page: loads the new build if one is waiting. */
export function reloadIfUpdateWaiting(): void {
  if (updateWaiting) window.location.reload();
}
