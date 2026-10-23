"use client";

import {
  LazyMotion, m, MotionConfig, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform,
  type HTMLMotionProps, type MotionValue, type Variants,
} from "motion/react";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

/** Short, ease-out. Only opacity/transform/filter are animated (GPU, no layout shift). */
const EASE = [0.2, 0.7, 0.2, 1] as const;
const VIEWPORT = { once: true, amount: 0.15 } as const;
const SPRING = { type: "spring", stiffness: 140, damping: 18, mass: 0.9 } as const;

const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

/** Content stays visible without JS (see LandingStyles noscript rule); reduced motion drops movement. */
export function LandingMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

type Tag = "dl" | "div" | "li" | "p" | "header" | "ul" | "ol" | "section" | "span" | "tbody" | "tr";
const tagOf = (as: Tag) => m[as] as unknown as typeof m.div;

/** Pointer-follow 3D tilt (mouse only, off under reduced motion). Returns style + handlers for a motion element. */
function useTilt(max: number) {
  const reduce = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const cfg = { stiffness: 160, damping: 20, mass: 0.6 };
  const rotateX = useSpring(rx, cfg);
  const rotateY = useSpring(ry, cfg);
  return {
    style: { rotateX, rotateY, transformPerspective: 900 },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (reduce || e.pointerType !== "mouse") return;
      const r = e.currentTarget.getBoundingClientRect();
      ry.set(((e.clientX - r.left) / r.width - 0.5) * 2 * max);
      rx.set(-((e.clientY - r.top) / r.height - 0.5) * 2 * max);
    },
    onPointerLeave() {
      rx.set(0);
      ry.set(0);
    },
  };
}

/** Pointer-attraction for primary CTAs (mouse only, off under reduced motion). */
function useMagnet(strength: number) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const cfg = { stiffness: 220, damping: 18, mass: 0.4 };
  const sx = useSpring(x, cfg);
  const sy = useSpring(y, cfg);
  return {
    style: { x: sx, y: sy },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (reduce || e.pointerType !== "mouse") return;
      const r = e.currentTarget.getBoundingClientRect();
      x.set((e.clientX - (r.left + r.width / 2)) * strength);
      y.set((e.clientY - (r.top + r.height / 2)) * strength);
    },
    onPointerLeave() {
      x.set(0);
      y.set(0);
    },
  };
}

type From = "up" | "left" | "right" | "scale";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "ref"> {
  as?: Tag;
  delay?: number;
  /** Spring instead of tween: for panels/cards "rising over" the blue. */
  spring?: boolean;
  y?: number;
  /** Entry direction. `scale` grows from 94%. */
  from?: From;
  /** Blur-to-sharp on entry (filter only). */
  blur?: boolean;
  /** Subtle 3D tilt following the pointer (mouse only). */
  tilt?: boolean;
}

const SIDE = 36;

function offsetFor(from: From, y: number) {
  if (from === "left") return { x: -SIDE, y: 0 };
  if (from === "right") return { x: SIDE, y: 0 };
  if (from === "scale") return { scale: 0.94, y: Math.min(y, 16) };
  return { y };
}

/** Fade + move in when scrolled into view (once). Opacity/transform/filter only. */
export function Reveal({ as = "div", delay = 0, spring = false, y = 20, from = "up", blur = false, tilt = false, style, ...rest }: RevealProps) {
  const Tag = tagOf(as);
  const t = useTilt(5);
  return (
    <Tag
      data-lp=""
      initial={{ opacity: 0, ...offsetFor(from, y), ...(blur ? { filter: "blur(8px)" } : {}) }}
      whileInView={{ opacity: 1, x: 0, y: 0, scale: 1, ...(blur ? { filter: "blur(0px)" } : {}) }}
      viewport={VIEWPORT}
      transition={spring ? { ...SPRING, delay } : { duration: 0.7, ease: EASE, delay }}
      {...(tilt ? { style: { ...t.style, ...style } } : style ? { style } : {})}
      {...(tilt ? { onPointerMove: t.onPointerMove, onPointerLeave: t.onPointerLeave } : {})}
      {...rest}
    />
  );
}

/** Wrapper that tilts its content towards the pointer. */
export function Tilt({ children, className, max = 6 }: { children: ReactNode; className?: string | undefined; max?: number }) {
  const t = useTilt(max);
  return (
    <m.div className={className} style={t.style} onPointerMove={t.onPointerMove} onPointerLeave={t.onPointerLeave}>
      {children}
    </m.div>
  );
}

const LIST: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const ITEM: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};
const ITEM_POP: Variants = {
  hidden: { opacity: 0, scale: 0.88 },
  show: { opacity: 1, scale: 1, transition: SPRING },
};

interface StaggerProps extends Omit<HTMLMotionProps<"ul">, "ref"> { as?: "ul" | "ol" | "div" | "dl" | "tbody" }

/** Container that staggers its StaggerItem children on scroll. */
export function Stagger({ as = "ul", ...rest }: StaggerProps) {
  const Tag = tagOf(as);
  return <Tag data-lp="" variants={LIST} initial="hidden" whileInView="show" viewport={VIEWPORT} {...(rest as object)} />;
}

interface StaggerItemProps extends Omit<HTMLMotionProps<"li">, "ref"> { as?: "li" | "div" | "tr"; pop?: boolean; lift?: boolean }

export function StaggerItem({ as = "li", pop = false, lift = false, ...rest }: StaggerItemProps) {
  const Tag = tagOf(as);
  return <Tag data-lp="" variants={pop ? ITEM_POP : ITEM} whileHover={lift ? { y: -3 } : {}} {...(rest as object)} />;
}

/** Gentle idle float (transform only). Static under reduced motion. */
export function Float({ children, className, delay = 0, amount = 8 }: { children: ReactNode; className?: string; delay?: number; amount?: number }) {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      animate={reduce ? { y: 0 } : { y: [0, -amount, 0] }}
      transition={{ duration: 6 + delay, ease: "easeInOut", repeat: Infinity, delay }}
    >
      {children}
    </m.div>
  );
}

/** Slow continuous rotation for the lime star. The outer element keeps CSS positioning. */
export function Spin({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.div className={className} animate={reduce ? { rotate: 0 } : { rotate: 360 }} transition={{ duration: 48, ease: "linear", repeat: Infinity }}>
      {children}
    </m.div>
  );
}

/** Counts up once in view. SSR renders the final value so nothing is empty without JS. */
export function CountUp({ to, suffix = "", className }: { to: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView || reduce) return;
    const start = performance.now();
    const duration = 1100;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = `${Math.round(to * (1 - (1 - t) ** 3))}${suffix}`;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    el.textContent = `0${suffix}`;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, to, suffix]);
  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{to}{suffix}</span>;
}

/**
 * Headline: words sharpen from blur and rise in sequence; the trailing lime period pops last.
 * The hidden state keeps 55% opacity so the server-rendered text is already a paint/LCP
 * candidate before hydration (opacity:0 text would delay LCP until JS runs).
 */
export function HeroTitle({ id, className, text }: { id: string; className?: string; text: string }) {
  const words = text.split(" ");
  const word = (i: number): Variants => ({
    hidden: { opacity: 0.55, y: "0.35em", filter: "blur(10px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: EASE, delay: 0.09 * i } },
  });
  return (
    <m.h1 id={id} className={className} initial="hidden" animate="show">
      {words.map((w, i) => (
        <m.span key={`${w}-${i}`} data-lp="" variants={word(i)} className="inline-block">
          {w}{i < words.length - 1 ? " " : ""}
        </m.span>
      ))}
      <m.span
        data-lp=""
        className="inline-block text-lime"
        variants={{ hidden: { opacity: 0, scale: 0 }, show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 420, damping: 12, delay: 0.09 * words.length + 0.15 } } }}
      >
        .
      </m.span>
    </m.h1>
  );
}

/** Hero checklist row; the lime highlight bar slides in from the left. */
export function CheckRow({ highlight, index, children }: { highlight: boolean; index: number; children: ReactNode }) {
  return (
    <m.li
      data-lp=""
      className={`relative rounded-md px-2 py-1.5 ${highlight ? "font-bold text-ink" : "text-white/90"}`}
      initial={{ opacity: 0, x: -10, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.5 + index * 0.09 }}
    >
      {highlight ? (
        <m.span
          aria-hidden
          data-lp=""
          className="absolute inset-0 origin-left rounded-md bg-lime"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.95 }}
        />
      ) : null}
      <span className="relative flex items-center gap-2">{children}</span>
    </m.li>
  );
}

/** Decorative hero glow with subtle scroll-linked parallax. */
export function HeroGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90]);
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <m.div
        style={{ y }}
        className="absolute -top-24 -right-24 size-[clamp(240px,45vw,560px)] rounded-full bg-[radial-gradient(circle,rgba(190,242,100,0.22)_0%,rgba(190,242,100,0)_68%)]"
      />
    </div>
  );
}

/** Link whose arrow nudges diagonally on hover/focus. `magnetic` adds a soft pull towards the pointer. */
const MotionLink = m.create(Link);
interface ArrowLinkProps { href: string; className?: string; "aria-label"?: string; magnetic?: boolean; children: ReactNode }
export function ArrowLink({ children, href, className, magnetic = false, "aria-label": ariaLabel }: ArrowLinkProps) {
  const mag = useMagnet(0.28);
  return (
    <MotionLink
      href={href}
      {...(className ? { className } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(magnetic ? { style: mag.style, onPointerMove: mag.onPointerMove, onPointerLeave: mag.onPointerLeave } : {})}
      whileHover="hover"
      whileFocus="hover"
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </MotionLink>
  );
}
export function ArrowNudge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.span aria-hidden className={`inline-flex ${className ?? ""}`} variants={{ hover: { x: 3, y: -3 } }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
      {children}
    </m.span>
  );
}

/** "Presupuesto aceptado" steps highlight one after another. */
export function QuoteSteps({ steps }: { steps: readonly { label: string; active: boolean }[] }) {
  return (
    <m.ul
      className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm font-semibold"
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.28, delayChildren: 0.35 } } }}
    >
      {steps.map(({ label, active }) => (
        <m.li
          key={label}
          data-lp=""
          className="relative overflow-hidden rounded-md bg-white/10 px-2 py-1"
          variants={{ hidden: { opacity: 0, x: 12 }, show: { opacity: 1, x: 0, transition: { duration: 0.45, ease: EASE } } }}
        >
          {active ? (
            <m.span
              aria-hidden
              data-lp=""
              className="absolute inset-0 origin-left bg-lime"
              variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.5, ease: EASE, delay: 0.5 } } }}
            />
          ) : null}
          <span className={`relative ${active ? "text-ink" : ""}`}>{label}</span>
        </m.li>
      ))}
    </m.ul>
  );
}

const StepsContext = createContext<MotionValue<number> | null>(null);

/** Wraps the "cómo funciona" list: a lime connector line draws as the section scrolls through, lighting each step. */
export function StepsProgress({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.5 });
  return (
    <StepsContext.Provider value={progress}>
      <div ref={ref}>
        <div aria-hidden className="mb-6 h-1 overflow-hidden rounded-full bg-white/20">
          <m.div className="h-full origin-left rounded-full bg-lime shadow-[0_0_16px_rgba(210,243,76,0.8)]" style={{ scaleX: progress }} />
        </div>
        {children}
      </div>
    </StepsContext.Provider>
  );
}

/** Big lime step number, rendered once (a glow layer behind it lights up with the scroll progress). */
export function StepNumber({ index, total, className }: { index: number; total: number; className?: string }) {
  const progress = useContext(StepsContext);
  const fallback = useMotionValue(1);
  const at = (index + 0.5) / total;
  const glow = useTransform(progress ?? fallback, [Math.max(at - 0.12, 0), at], [0.15, 1]);
  return (
    <span aria-hidden className={`relative inline-block text-[clamp(3rem,2.4rem+2vw,4.5rem)] leading-none font-extrabold tracking-[-0.04em] text-lime ${className ?? ""}`}>
      <m.span className="absolute inset-0 -z-10 rounded-full bg-lime/40 blur-2xl" style={{ opacity: glow }} />
      {index + 1}
    </span>
  );
}

/** Infinite horizontal marquee of text items. Static, centered and de-duplicated under reduced motion. */
export function Marquee({ items, itemClassName }: { items: readonly string[]; itemClassName?: string }) {
  const reduce = useReducedMotion();
  const gap = "gap-x-[clamp(32px,6vw,72px)] pr-[clamp(32px,6vw,72px)]";
  const row = (hidden: boolean, key: number) => (
    <ul key={key} {...(hidden ? { "aria-hidden": true } : {})} className={`m-0 flex shrink-0 list-none items-center p-0 ${gap}`}>
      {items.map((name) => <li key={name} className={`whitespace-nowrap ${itemClassName ?? ""}`}>{name}</li>)}
    </ul>
  );
  if (reduce) {
    return (
      <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-[clamp(24px,5vw,64px)] gap-y-4 p-0">
        {items.map((name) => <li key={name} className={itemClassName}>{name}</li>)}
      </ul>
    );
  }
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <m.div className="flex w-max" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 28, ease: "linear", repeat: Infinity }}>
        {[0, 1, 2, 3].map((i) => row(i > 0, i))}
      </m.div>
    </div>
  );
}

/** Number that eases to its new value (spring). aria-hidden: pair it with a static sr-only text. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const target = useMotionValue(value);
  const spring = useSpring(target, { stiffness: 110, damping: 22, mass: 0.8 });
  const text = useTransform(spring, (v) => String(Math.round(v)));
  useEffect(() => {
    if (reduce) {
      target.jump(value);
      spring.jump(value);
    } else {
      target.set(value);
    }
  }, [value, reduce, target, spring]);
  return <m.span aria-hidden className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{text}</m.span>;
}

interface DemoPlayerProps { webm: string; mp4: string; poster: string; label: string; width: number; height: number }

/** Silent looping demo: autoplays muted on load and loops; shows controls only if the browser blocks playback. */
export function DemoPlayer({ webm, mp4, poster, label, width, height }: DemoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React does not reliably reflect `muted` as a DOM property; browsers only autoplay muted media.
    el.muted = true;
    el.defaultMuted = true;
    el.play().catch(() => setBlocked(true));
  }, []);
  return (
    <video
      ref={ref}
      className="block h-auto w-full"
      width={width}
      height={height}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster={poster}
      aria-label={label}
      {...(blocked ? { controls: true } : {})}
    >
      <source src={mp4} type="video/mp4" />
      <source src={webm} type="video/webm" />
    </video>
  );
}
