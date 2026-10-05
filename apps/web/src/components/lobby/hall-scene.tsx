"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";

import { room } from "@/lib/rooms";
import { MODE_NAMES, type PlayableMode } from "@/lib/types";

/** A CSS custom property for an animation delay or period, which React's style type does not know. */
function timing(values: Record<string, string>): CSSProperties {
  return values as CSSProperties;
}

const STARS: [number, number, number][] = [
  [40, 46, 0],
  [96, 92, 1.1],
  [150, 34, 2.3],
  [214, 70, 0.6],
  [262, 28, 1.8],
  [396, 40, 2.9],
  [438, 96, 0.3],
  [470, 24, 1.5],
  [600, 132, 2.1],
  [612, 38, 0.9],
  [70, 150, 2.6],
  [582, 196, 1.3],
];

/** A window pane: lit paper-yellow, with glazing bars. */
function Pane({
  x,
  y,
  width,
  height,
  delay,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  delay: number;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} className="fill-line" />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="glass lit fill-parchment"
        style={timing({ "--delay": `${delay}s` })}
      />
      <path
        d={`M${x + width / 2} ${y} v${height} M${x} ${y + height / 2} h${width}`}
        className="stroke-ink"
        strokeWidth="2"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="fill-none stroke-rose"
        strokeWidth="2"
      />
    </g>
  );
}

function HallSpot({
  mode,
  halo,
  active,
  onActive,
  children,
}: {
  mode: PlayableMode;
  halo: ReactNode;
  active: boolean;
  onActive: (mode: PlayableMode | null) => void;
  children: ReactNode;
}) {
  const { href, place } = room(mode);
  return (
    <Link
      href={href}
      className="spot"
      data-active={active}
      aria-label={`${place}: ${MODE_NAMES[mode]}`}
      onMouseEnter={() => onActive(mode)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(mode)}
      onBlur={() => onActive(null)}
    >
      {children}
      <g className="halo fill-none stroke-sage" strokeWidth="4">
        {halo}
      </g>
    </Link>
  );
}

/**
 * Wrenfield Hall at night, with a letter being written in the foreground. Two
 * parts of the picture lead to the two open rooms: the front door and the west
 * window. Each is a real link, reachable by keyboard, and the caption
 * underneath says where it goes.
 */
export function HallScene() {
  const [active, setActive] = useState<PlayableMode | null>(null);

  const shown = active ? room(active) : null;

  return (
    <figure className="flex flex-col gap-3">
      <div className="stepped bg-ornament p-1.5">
        <svg
          viewBox="0 0 640 470"
          role="group"
          aria-label="Wrenfield Hall at night. The front door and the lit west window each lead to a game."
          className="scene stepped block h-auto w-full"
        >
          {/* Night sky */}
          <rect width="640" height="470" className="fill-panel" />
          {STARS.map(([cx, cy, delay]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r="1.8"
              className="star fill-parchment"
              style={timing({ "--delay": `${delay}s` })}
            />
          ))}
          <circle cx="548" cy="72" r="30" className="fill-parchment" />
          <circle cx="538" cy="64" r="6" className="fill-parchment-shade" />
          <circle cx="558" cy="82" r="4" className="fill-parchment-shade" />
          <rect x="60" y="104" width="130" height="10" rx="5" className="cloud fill-line" />
          <rect
            x="420"
            y="128"
            width="170"
            height="12"
            rx="6"
            className="cloud fill-line"
            style={timing({ "--delay": "-9s" })}
          />

          {/* The park */}
          <path d="M0 318 Q150 270 320 304 T640 292 V470 H0 Z" className="fill-claret" />
          <path d="M296 344 H344 L500 470 H140 Z" className="fill-line" />

          {/* Chimney smoke */}
          {[
            [140, 168, 0],
            [140, 168, 1.7],
            [140, 168, 3.4],
            [500, 168, 0.9],
            [500, 168, 2.6],
          ].map(([cx, cy, delay], index) => (
            <circle
              key={index}
              cx={cx}
              cy={cy}
              r="7"
              className="puff fill-text-secondary"
              style={timing({ "--delay": `${delay}s` })}
            />
          ))}

          {/* The Hall */}
          <g className="fill-ink stroke-rose" strokeWidth="2" strokeLinejoin="miter">
            <rect x="132" y="170" width="16" height="34" />
            <rect x="492" y="170" width="16" height="34" />
            <path d="M84 344 V214 H100 V204 H224 V214 H240 V344 Z" />
            <path d="M400 344 V214 H416 V204 H540 V214 H556 V344 Z" />
            <path d="M228 344 V160 H248 V146 H272 V132 H368 V146 H392 V160 H412 V344 Z" />
            <path d="M292 132 V66 H348 V132 Z" />
            <path d="M286 66 H354 L344 52 H296 Z" />
            <path d="M320 52 V30" />
            <path d="M320 22 L326 30 L320 38 L314 30 Z" className="fill-rose" />
          </g>
          <g className="stroke-rose" strokeWidth="1.5">
            <path d="M84 226 H240 M400 226 H556 M228 172 H412" />
            <path d="M228 232 H412" />
          </g>

          {/* Windows that are only windows */}
          <Pane x={186} y={248} width={30} height={58} delay={0.5} />
          <Pane x={424} y={248} width={30} height={58} delay={1.3} />
          <Pane x={250} y={184} width={26} height={38} delay={0.9} />
          <Pane x={364} y={184} width={26} height={38} delay={1.7} />
          <Pane x={307} y={184} width={26} height={38} delay={0.2} />

          {/* The two ways in. Their order here is the order Tab reaches them in, and it matches
              the list of rooms below the picture. Neither overlaps the other, so paint order is free. */}
          {/* The Drawing Room, the main game: the front door */}
          <HallSpot
            mode="drawing_room"
            active={active === "drawing_room"}
            onActive={setActive}
            halo={<rect x="266" y="240" width="108" height="110" />}
          >
            <g className="fill-ink stroke-rose" strokeWidth="2">
              <rect x="272" y="246" width="96" height="10" />
              <rect x="278" y="256" width="10" height="88" />
              <rect x="352" y="256" width="10" height="88" />
              <path d="M262 344 H378 V352 H252 V360 H388 V352 H378" />
            </g>
            <rect x="298" y="266" width="44" height="78" className="fill-line" />
            <rect
              x="298"
              y="266"
              width="44"
              height="78"
              className="glass lit fill-sage"
              style={timing({ "--delay": "1.5s" })}
            />
            <path d="M320 266 V344" className="stroke-ink" strokeWidth="2" />
            <circle cx="314" cy="308" r="2" className="fill-ink" />
            <circle cx="326" cy="308" r="2" className="fill-ink" />
          </HallSpot>

          {/* A Weekend at Wrenfield: the west window */}
          <HallSpot
            mode="weekend"
            active={active === "weekend"}
            onActive={setActive}
            halo={<rect x="106" y="242" width="60" height="70" />}
          >
            <Pane x={112} y={248} width={48} height={58} delay={0.7} />
            <path d="M118 306 q18 -22 36 0" className="fill-none stroke-ink" strokeWidth="2" />
          </HallSpot>

          {/* The east window, the tower clock, and the post box led to rooms that have closed.
              They are scenery now. */}
          <g>
            <Pane x={480} y={248} width={48} height={58} delay={1.1} />
            <path
              d="M486 300 v-16 h6 v16 M494 300 v-22 h6 v22 M502 300 v-13 h6 v13 M512 300 v-19 h6 v19"
              className="fill-none stroke-ink"
              strokeWidth="2"
            />
          </g>
          <g>
            <circle
              cx="320"
              cy="98"
              r="20"
              className="fill-parchment stroke-rose"
              strokeWidth="2"
            />
            <path
              d="M320 81 v4 M320 111 v4 M303 98 h4 M333 98 h4"
              className="stroke-ink"
              strokeWidth="2"
            />
            <path
              d="M320 98 V84"
              className="hand stroke-ink"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ transformOrigin: "320px 98px", ...timing({ "--period": "40s" }) }}
            />
            <path
              d="M320 98 H330"
              className="hand stroke-ink"
              strokeWidth="3"
              strokeLinecap="round"
              style={{ transformOrigin: "320px 98px", ...timing({ "--period": "480s" }) }}
            />
            <circle cx="320" cy="98" r="2.5" className="fill-stamp" />
          </g>
          <g>
            <rect
              x="574"
              y="356"
              width="10"
              height="26"
              className="fill-ink stroke-rose"
              strokeWidth="2"
            />
            <rect
              x="562"
              y="328"
              width="34"
              height="30"
              className="fill-stamp stroke-rose"
              strokeWidth="2"
            />
            <rect x="569" y="338" width="20" height="4" className="fill-ink" />
          </g>

          {/* In the foreground: a letter being written */}
          <g transform="translate(34 368) rotate(-5)">
            <rect
              width="170"
              height="92"
              className="fill-parchment stroke-ink-muted"
              strokeWidth="2"
            />
            <rect
              x="6"
              y="6"
              width="158"
              height="80"
              className="fill-none stroke-ink-muted"
              strokeWidth="1"
            />
            {[
              ["M18 26 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0", 0],
              ["M18 44 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0", 1.6],
              ["M18 62 q10 -8 20 0 t20 0 t20 0 t20 0", 3.2],
            ].map(([d, delay]) => (
              <path
                key={String(d)}
                d={String(d)}
                pathLength={1}
                className="ink fill-none stroke-ink"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={timing({ "--delay": `${delay}s` })}
              />
            ))}
            <g className="seal">
              <circle cx="146" cy="70" r="13" className="fill-stamp" />
              <path
                d="M140 70 l4 5 l8 -10"
                className="fill-none stroke-parchment"
                strokeWidth="2.5"
              />
            </g>
            {/* The pen */}
            <g transform="translate(120 58) rotate(35) translate(-9 -118)">
              <g className="pen">
                <path d="M0 0 h18 v92 h-18 Z" className="fill-ink stroke-rose" strokeWidth="2" />
                <path d="M0 14 h18 M0 22 h18" className="stroke-rose" strokeWidth="2" />
                <path d="M2 92 h14 l-7 26 Z" className="fill-rose stroke-ink" strokeWidth="1.5" />
                <path d="M9 100 v14" className="stroke-ink" strokeWidth="1.5" />
              </g>
            </g>
          </g>
        </svg>
      </div>
      <figcaption
        aria-live="polite"
        className="min-h-32 border border-line bg-panel px-4 py-3"
        data-testid="hall-caption"
      >
        {shown ? (
          <>
            <span className="deco-label block text-ornament">{shown.place}</span>
            <span className="deco-title block text-xl">{MODE_NAMES[shown.mode]}</span>
            <span className="block text-sm text-text-secondary">{shown.blurb}</span>
          </>
        ) : (
          <>
            <span className="deco-label block text-ornament">Wrenfield Hall</span>
            <span className="block text-sm text-text-secondary">
              Try the front door or the west window. Each leads to a game.
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
