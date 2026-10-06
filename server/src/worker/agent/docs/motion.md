# Motion guide — animation and transitions

`.tau/DESIGN.md` gives the app a motion level from 1 to 10. Build to that level: less is wrong for a lively app, more is wrong for a quiet one.

`src/index.css` already turns all animation off for people whose system asks for reduced motion. You do not need to handle that yourself — but nothing may *depend* on an animation finishing.

## What is installed
`tw-animate-css` is installed. It gives enter and exit animations as classes:
- `animate-in` with `fade-in`, `zoom-in-95`, `slide-in-from-bottom-4` (also `-top-`, `-left-`, `-right-`)
- `animate-out` with the matching `fade-out`, `zoom-out-95`, `slide-out-to-*`
- `duration-300`, `delay-150`, `ease-out`, and `fill-mode-both` so a delayed element stays hidden until it starts.

Tailwind's own `transition-*`, `hover:`, `active:` and `animate-pulse` / `animate-spin` are available as always.

## By level

**1–2: still.** State changes are instant or nearly so. `transition-colors duration-150` on interactive things, nothing else.

**3–4: responsive.** Add feedback to touch: `transition-[color,background-color,transform] duration-200`, `hover:-translate-y-0.5`, `active:scale-[0.98]`. No animation on load.

**5–6: eased in.** As above, plus content enters once when a screen appears: `animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both`. Stagger a list by giving each item a growing delay — `style={{ animationDelay: `${i * 60}ms` }}` — and stop staggering after about eight items. Reveal sections as they scroll into view with the hook below.

**7–8: lively.** As above, plus things that move with meaning: numbers that count up to their value, progress bars that fill, a pressed button that springs back (`transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]`), a success state that pops. Hover states can be bolder — a card that lifts and tilts, an image that scales inside its frame.

**9–10: cinematic.** As above, plus animation that follows scroll or rearranges layout. This needs a library: `bun add motion`, then `import { motion } from "motion/react"`. Use `layout` for elements that change place, `whileInView` for reveals, `useScroll` and `useTransform` for parallax. Keep it to a few set pieces; a page where everything moves reads as noise.

## Reveal on scroll, without a library

```tsx
function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); io.disconnect() }
    }, { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, seen }
}

// <section ref={ref} className={seen ? "animate-in fade-in slide-in-from-bottom-4 duration-700" : "opacity-0"}>
```

## Rules
- Animate `transform` and `opacity`. Animating width, height, top or left makes the page stutter.
- Entrances are 300–700ms and ease out. Feedback on touch is under 200ms.
- An element animates in once. Do not replay it every time it scrolls back into view.
- Never loop an animation that is not showing that something is in progress.
- Never delay the main content of a screen by more than half a second.
- Dialogs, sheets, menus and tooltips already animate. Do not add to them.
