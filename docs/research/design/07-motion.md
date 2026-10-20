# Motion: crafted, not gimmicky

## Findings

**Purposeful motion (sourced)**
- Apple HIG: add motion purposefully, not for its own sake; never make motion the only way to convey important information. https://developer.apple.com/design/human-interface-guidelines/motion (read via a mirror snippet)
- Emil Kowalski, "Great animations": UI animations should usually be shorter than 300 ms; use `ease-out` for responsive motion; never animate keyboard-initiated actions (repeated hundreds of times a day). https://emilkowal.ski/ui/great-animations
- Rauno Freiberg, interaction design: motion should follow physics and be interruptible; repeated animation becomes cognitive burden; removing motion from frequent actions makes an app feel faster. https://rauno.me/craft/interaction-design
- Material 1 (older; M3 tokens not verified): transitions ~300 ms, complex full-screen 375 ms, entering 225 ms, exiting 195 ms; curves standard / deceleration (enter) / acceleration (exit). https://m1.material.io/motion/duration-easing.html

**Reduced motion (sourced)**
- MDN `prefers-reduced-motion`: replace scale/pan with a dissolve; large scaling and panning can trigger vestibular symptoms. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Motion: `<MotionConfig reducedMotion="user">` disables transform/layout animations and keeps opacity/colour; `useReducedMotion()` returns a boolean. https://motion.dev/docs/react-accessibility

**Spring and timing API (sourced)**
- Motion spring options: `type: "spring"`, `visualDuration`, `bounce`, `stiffness`, `damping`, `mass`. https://motion.dev/docs
- `AnimateNumber` takes per-property transitions, e.g. `y: { type: "spring", visualDuration: 0.4, bounce: 0.2 }`. https://motion.dev/docs/react-animate-number

**Camera fly-to (sourced)**
- `flyTo`: `curve` default 1.42 (amount of zoom-out), `speed` default 1.2, `maxDuration` caps duration. https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/FlyToOptions/ and https://docs.mapbox.com/mapbox-gl-js/api/properties

**Over-animation tells (judgment)**
- Every number ticking on every frame; the same fly-in on every click; bouncy springs on data panels; entrances of 500 ms+; animating keyboard actions; motion as the only signal.

## Concrete rules for Malas Ngoding

Proposals built from the sourced limits; tune by eye. (Agent could not write files; controller transcribed this report.)

- Panels: enter 225 ms, exit 195 ms. Easing enter `[0, 0, 0.2, 1]`, exit `[0.4, 0, 1, 1]`.
- Panel springs: `{ type: "spring", visualDuration: 0.25, bounce: 0 }`. No bounce on data panels.
- Small UI (buttons, toggles): `{ type: "spring", visualDuration: 0.2, bounce: 0.15 }`.
- Count-up numbers: 900 ms, ease `[0.16, 1, 0.3, 1]`; only on first reveal or a real data change, never on hover.
- Chart transitions: 300 ms ease-out; animate the data change, not a full redraw.
- Stagger: 30 ms between siblings, total cap 300 ms; first mount only.
- Camera: `flyTo({ curve: 1.2, speed: 0.9, maxDuration: 2000 })`; small zoom-out; stop on user drag or click.
- Keyboard and repeated actions: no animation.
- Reduced motion: `<MotionConfig reducedMotion="user">`; map uses `jumpTo` / duration 0; count-up shows the final value; keep opacity fades.
- Never use motion as the only signal for a data change; pair it with colour or a label.
