/** Without JS, Motion's initial hidden state (opacity/transform/blur) would hide content: force it visible. */
export function LandingStyles() {
  return (
    <noscript>
      <style>{`[data-lp]{opacity:1!important;transform:none!important;filter:none!important}`}</style>
    </noscript>
  );
}
