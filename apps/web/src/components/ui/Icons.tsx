import type { SVGProps } from "react";

/**
 * The icon set.
 *
 * Drawn rather than typed, for the same reason the star ratings are: an emoji
 * is a glyph from whatever font resolves it, so its weight and alignment drift
 * between platforms and it cannot take a stroke, a fill or a colour token.
 *
 * One visual language throughout: 24-unit box, 1.6 stroke, round joins, and
 * `currentColor` so an icon takes the colour of the text it sits beside. Solid
 * variants exist only where a filled state means something, which here is a
 * reaction you have chosen and a post you have saved.
 */

type IconProps = SVGProps<SVGSVGElement> & { filled?: boolean };

function Icon({ filled, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[18px] shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Love: a five-petal sampaguita rather than a heart.
 *
 * A heart on a marketplace reads as romance or as a plain bookmark. A flower
 * reads as "this is beautiful", which is the thing people actually mean about
 * a finished piece, and sampaguita is the national flower.
 */
export function FlowerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          cx="12"
          cy="7.4"
          rx="3.1"
          ry="4.4"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Support: a handshake, for backing the maker rather than the piece. */
export function HandshakeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 11.5l3-3.2 3.6.9 2.9-1.6 2.9 1.6 3.6-.9 3 3.2" />
      <path d="M8 13.2l2.6 2.5c.6.6 1.5.6 2.1 0l.4-.4" />
      <path d="M13.1 15.3l1.8 1.7c.6.6 1.5.5 2-.1" />
      <path d="M16.9 16.9l1.3 1.2" />
      <path d="M5.5 8.3v6.1M18.5 8.3v6.1" />
    </Icon>
  );
}

/** Like: the plain nod. */
export function ThumbUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 10.5v9H4.8A1.3 1.3 0 013.5 18.2v-6.4A1.3 1.3 0 014.8 10.5H7z" />
      <path d="M7 10.5l3.8-7.1c1.4.1 2.3 1 2.3 2.4v3.1h4.9a2.1 2.1 0 012 2.7l-1.7 6a2.1 2.1 0 01-2 1.5H7" />
    </Icon>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.5 12.1c0 3.9-3.8 7.1-8.5 7.1a9.9 9.9 0 01-2.7-.4l-4.8 1.6 1.6-3.7a6.6 6.6 0 01-2.1-4.6C4 8.2 7.8 5 12 5s8.5 3.2 8.5 7.1z" />
    </Icon>
  );
}

/** Save: a bookmark, filled once it is yours. */
export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 4.5h11a1 1 0 011 1v14.2l-6.5-4-6.5 4V5.5a1 1 0 011-1z" />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8l4.2 4.2" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.5h15M9.5 6.5V5a1 1 0 011-1h3a1 1 0 011 1v1.5" />
      <path d="M6.5 6.5l.8 12a1 1 0 001 .9h7.4a1 1 0 001-.9l.8-12" />
    </Icon>
  );
}
