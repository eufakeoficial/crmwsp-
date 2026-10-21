/** Landing-only CSS: one gentle entrance animation. Reduced motion disables it. */
export function LandingStyles() {
  return (
    <style>{`
@keyframes lp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.lp-rise { animation: lp-rise .7s cubic-bezier(.2,.7,.2,1) both; }
.lp-rise-2 { animation-delay: .12s; }
.lp-rise-3 { animation-delay: .24s; }
@media (prefers-reduced-motion: reduce) { .lp-rise { animation: none; } }
`}</style>
  );
}
