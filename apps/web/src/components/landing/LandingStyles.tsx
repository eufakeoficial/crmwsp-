/** Without JS, Motion's initial hidden state would hide content: force it visible. */
export function LandingStyles() {
  return (
    <noscript>
      <style>{`[data-lp]{opacity:1!important;transform:none!important}`}</style>
    </noscript>
  );
}
