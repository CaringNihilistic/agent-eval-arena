// Draws the built-in guest portraits: six guests, four expressions each, as
// simple original SVGs in the site's palette.
//
//   node scripts/make-guest-portraits.mjs
//
// Output: apps/web/public/guests/<id>/<expression>.svg. To replace a portrait
// with a proper illustration, save it beside the SVG as <expression>.png; the
// site prefers the PNG and needs no code change.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "guests");

// The site's palette (apps/web/src/app/globals.css).
const C = {
  claret: "#3A1A22",
  panel: "#4A2430",
  line: "#6A3A47",
  parchment: "#E2D6BC",
  shade: "#D6C8A8",
  rule: "#8A745A",
  ink: "#2A141A",
  text: "#F0E4D4",
  sage: "#A9C0A0",
  rose: "#C9A08A",
  stamp: "#9C2F2B",
  blush: "#E59A8F",
};

const EXPRESSIONS = ["neutral", "happy", "shocked", "flustered"];

/** Rays behind the sitter: an Art Deco sunburst, kept faint. */
function sunburst() {
  const rays = [];
  for (let angle = -80; angle <= 80; angle += 16) {
    const radians = (angle * Math.PI) / 180;
    const x = 100 + Math.sin(radians) * 170;
    const y = 150 - Math.cos(radians) * 170;
    rays.push(`<line x1="100" y1="150" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
  }
  return `<g stroke="${C.rose}" stroke-width="1" opacity="0.28">${rays.join("")}</g>`;
}

/** Eyes, brows, and mouth for an expression. The face is centred on x=100. */
function face(expression, { eyeY = 104, mouthY = 134 } = {}) {
  const ink = `stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" fill="none"`;
  const left = 86;
  const right = 114;
  switch (expression) {
    case "happy":
      return `
        <path d="M${left - 7} ${eyeY - 11} q7 -5 14 0" ${ink}/>
        <path d="M${right - 7} ${eyeY - 11} q7 -5 14 0" ${ink}/>
        <path d="M${left - 5} ${eyeY + 1} q5 -6 10 0" ${ink}/>
        <path d="M${right - 5} ${eyeY + 1} q5 -6 10 0" ${ink}/>
        <path d="M88 ${mouthY - 2} q12 11 24 0" ${ink}/>`;
    case "shocked":
      return `
        <path d="M${left - 7} ${eyeY - 16} q7 -4 14 0" ${ink}/>
        <path d="M${right - 7} ${eyeY - 16} q7 -4 14 0" ${ink}/>
        <circle cx="${left}" cy="${eyeY}" r="5.5" fill="${C.text}" stroke="${C.ink}" stroke-width="2"/>
        <circle cx="${right}" cy="${eyeY}" r="5.5" fill="${C.text}" stroke="${C.ink}" stroke-width="2"/>
        <circle cx="${left}" cy="${eyeY}" r="2" fill="${C.ink}"/>
        <circle cx="${right}" cy="${eyeY}" r="2" fill="${C.ink}"/>
        <ellipse cx="100" cy="${mouthY + 2}" rx="6" ry="8" fill="${C.ink}"/>`;
    case "flustered":
      return `
        <path d="M${left - 7} ${eyeY - 9} l14 -5" ${ink}/>
        <path d="M${right + 7} ${eyeY - 9} l-14 -5" ${ink}/>
        <circle cx="${left + 3}" cy="${eyeY + 1}" r="2.6" fill="${C.ink}"/>
        <circle cx="${right + 3}" cy="${eyeY + 1}" r="2.6" fill="${C.ink}"/>
        <ellipse cx="${left - 6}" cy="${eyeY + 16}" rx="8" ry="4.5" fill="${C.blush}" opacity="0.75"/>
        <ellipse cx="${right + 6}" cy="${eyeY + 16}" rx="8" ry="4.5" fill="${C.blush}" opacity="0.75"/>
        <path d="M88 ${mouthY} q4 -5 8 0 t8 0 t8 0" ${ink}/>
        <path d="M134 82 q5 9 0 13 q-5 -4 0 -13 z" fill="${C.text}" stroke="${C.ink}" stroke-width="1.5"/>`;
    default:
      return `
        <path d="M${left - 7} ${eyeY - 11} h14" ${ink}/>
        <path d="M${right - 7} ${eyeY - 11} h14" ${ink}/>
        <circle cx="${left}" cy="${eyeY}" r="2.6" fill="${C.ink}"/>
        <circle cx="${right}" cy="${eyeY}" r="2.6" fill="${C.ink}"/>
        <path d="M90 ${mouthY} h20" ${ink}/>`;
  }
}

const head = `<ellipse cx="100" cy="108" rx="36" ry="43" fill="${C.parchment}" stroke="${C.ink}" stroke-width="2.5"/>`;
const neck = `<path d="M86 144 v22 h28 v-22 z" fill="${C.shade}" stroke="${C.ink}" stroke-width="2.5"/>`;
const nose = `<path d="M100 108 l-4 14 h7" stroke="${C.ink}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const shoulders = (fill) =>
  `<path d="M22 240 q4 -62 64 -74 h28 q60 12 64 74 z" fill="${fill}" stroke="${C.ink}" stroke-width="2.5"/>`;

/** Each guest: what is drawn behind the head, and what is drawn over it. */
const GUESTS = {
  constance: {
    title: "Lady Constance Wrenfield",
    behind: `
      <ellipse cx="100" cy="52" rx="22" ry="17" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5"/>
      <path d="M60 110 q-6 -62 40 -62 q46 0 40 62 q-6 -36 -40 -38 q-34 2 -40 38 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5"/>`,
    body: `${shoulders(C.line)}
      <path d="M78 168 q22 20 44 0 v-10 h-44 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5"/>`,
    over: `
      <g fill="${C.text}" stroke="${C.ink}" stroke-width="1.5">
        <circle cx="76" cy="182" r="4.5"/><circle cx="87" cy="189" r="4.5"/><circle cx="100" cy="192" r="4.5"/>
        <circle cx="113" cy="189" r="4.5"/><circle cx="124" cy="182" r="4.5"/>
      </g>
      <path d="M64 118 v10 M136 118 v10" stroke="${C.rose}" stroke-width="3" stroke-linecap="round"/>`,
  },
  pike: {
    title: "Colonel Archibald Pike",
    behind: `
      <path d="M62 112 q-8 -14 0 -30 l6 30 z M138 112 q8 -14 0 -30 l-6 30 z" fill="${C.rule}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
    body: `${shoulders(C.sage)}
      <path d="M100 168 v72" stroke="${C.ink}" stroke-width="2.5"/>
      <g fill="${C.rose}" stroke="${C.ink}" stroke-width="1.5">
        <circle cx="110" cy="188" r="4"/><circle cx="110" cy="208" r="4"/><circle cx="110" cy="228" r="4"/>
      </g>
      <path d="M40 196 h30 v10 h-30 z" fill="${C.stamp}" stroke="${C.ink}" stroke-width="2"/>`,
    over: `
      <path d="M100 124 q-10 -6 -22 2 q-8 6 -14 0 q8 16 22 10 q10 -4 14 -8 q4 4 14 8 q14 6 22 -10 q-6 6 -14 0 q-12 -8 -22 -2 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"/>`,
    mouthY: 142,
  },
  ambrose: {
    title: "Dr. Felix Ambrose",
    behind: `
      <path d="M62 100 q-4 -44 38 -44 q42 0 38 44 q-8 -26 -30 -28 q-10 12 -46 28 z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
    body: `${shoulders(C.claret)}
      <path d="M86 166 l14 22 l14 -22 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M96 186 h8 l4 40 l-8 10 l-8 -10 z" fill="${C.rose}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`,
    over: `
      <g fill="none" stroke="${C.ink}" stroke-width="2.4">
        <circle cx="86" cy="104" r="11"/><circle cx="114" cy="104" r="11"/>
        <path d="M97 104 h6 M75 102 l-11 -4 M125 102 l11 -4"/>
      </g>`,
  },
  ivy: {
    title: "Miss Ivy Hartley",
    behind: `
      <path d="M58 132 q-10 -78 42 -78 q52 0 42 78 q-8 4 -14 -2 q6 -44 -28 -46 q-34 2 -28 46 q-6 6 -14 2 z" fill="${C.rule}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
    body: `${shoulders(C.rose)}
      <path d="M82 166 q18 18 36 0 l8 6 q-26 26 -52 0 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
    over: `
      <path d="M66 92 q34 -22 68 0 q-2 -10 -8 -16 q-26 -12 -52 0 q-6 6 -8 16 z" fill="${C.rule}" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M64 84 q36 -16 72 0" stroke="${C.sage}" stroke-width="5" fill="none"/>`,
  },
  julian: {
    title: "Mr. Julian Vane",
    behind: `
      <path d="M62 104 q-6 -50 40 -50 q30 0 38 22 q4 12 -2 28 q-4 -26 -22 -30 q-22 14 -54 30 z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M96 58 q22 -12 38 6" stroke="${C.rule}" stroke-width="2" fill="none"/>`,
    body: `${shoulders(C.shade)}
      <path d="M84 166 l16 20 l16 -20 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M100 186 l-18 -9 v18 z M100 186 l18 -9 v18 z" fill="${C.stamp}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="100" cy="186" r="3.5" fill="${C.stamp}" stroke="${C.ink}" stroke-width="2"/>
      <path d="M58 200 l12 14" stroke="${C.ink}" stroke-width="2"/>`,
    over: `
      <path d="M92 127 q8 -4 16 0" stroke="${C.ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  },
  pell: {
    title: "Mrs. Dorcas Pell",
    behind: `
      <path d="M60 104 q-4 -42 40 -44 q44 2 40 44 q-10 -22 -40 -22 q-30 0 -40 22 z" fill="${C.rule}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M58 76 q6 -34 42 -34 q36 0 42 34 q-20 -14 -42 -14 q-22 0 -42 14 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M56 78 q44 -22 88 0" stroke="${C.ink}" stroke-width="2.5" fill="none"/>`,
    body: `${shoulders(C.ink)}
      <path d="M78 166 l22 18 l22 -18 l8 8 l-30 26 l-30 -26 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M70 208 h60 v32 h-60 z" fill="${C.text}" stroke="${C.ink}" stroke-width="2.5"/>
      <circle cx="100" cy="204" r="5" fill="${C.rose}" stroke="${C.ink}" stroke-width="2"/>`,
    over: "",
  },
};

for (const [id, guest] of Object.entries(GUESTS)) {
  mkdirSync(join(OUT, id), { recursive: true });
  for (const expression of EXPRESSIONS) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" role="img" aria-label="${guest.title}, ${expression}">
  <rect width="200" height="240" fill="${C.panel}"/>
  ${sunburst()}
  ${guest.behind}
  ${guest.body}
  ${neck}
  ${head}
  ${nose}
  ${face(expression, { mouthY: guest.mouthY })}
  ${guest.over}
</svg>
`;
    writeFileSync(join(OUT, id, `${expression}.svg`), svg.replace(/\n\s*\n/g, "\n"));
  }
}
console.log(`Wrote ${Object.keys(GUESTS).length * EXPRESSIONS.length} portraits to ${OUT}`);
