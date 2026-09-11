import { useCallback, useEffect, useState } from "react";

/** Scrolled less than this from the top, the header is always shown. */
const NEAR_TOP_PX = 64;
/**
 * How far someone has to scroll in one direction before the header reacts.
 * Measured from where the last decision was made, not frame to frame, so a
 * slow scroll still counts and a thumb resting on the glass does not flicker
 * the header in and out.
 */
const TOLERANCE_PX = 12;

/**
 * Whether the header should slide out of the way: yes while scrolling down
 * through content, no as soon as the reader scrolls back up or nears the top.
 *
 * One passive scroll listener, coalesced to one read per animation frame, and
 * a state update only when the answer actually changes, so scrolling does not
 * re-render the header sixty times a second. No layout is read beyond
 * scrollY, which the browser already has.
 *
 * `paused` holds it shown, for while a menu is open or on a page where hiding
 * would only get in the way. `reveal` brings it back on demand, which is what
 * keyboard focus uses: a control you have tabbed to must be on screen.
 */
export function useHideOnScroll(paused: boolean): [hidden: boolean, reveal: () => void] {
  const [hidden, setHidden] = useState(false);
  const reveal = useCallback(() => setHidden(false), []);

  useEffect(() => {
    if (paused) {
      setHidden(false);
      return;
    }

    // iOS reports negative scroll positions while rubber-banding at the top.
    let anchor = Math.max(0, window.scrollY);
    let frame = 0;

    const decide = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const moved = y - anchor;

      if (y <= NEAR_TOP_PX) {
        setHidden(false);
        anchor = y;
      } else if (moved > TOLERANCE_PX) {
        setHidden(true);
        anchor = y;
      } else if (moved < -TOLERANCE_PX) {
        setHidden(false);
        anchor = y;
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(decide);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [paused]);

  return [hidden, reveal];
}
