import styled, { css } from "styled-components";
import { fadeIn } from "./Card";

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer-backdrop);
  background: rgba(0, 0, 0, 0.5);
  animation: ${fadeIn} var(--dur) var(--ease);
`;

const PanelRoot = styled.div`
  /* Desktop: the wrapper erases itself, so the panel it wraps stays a direct
     flex child of the shell with the width it already declares. Nothing about
     the column layout changes, and there is no geometry to keep in sync. */
  display: contents;

  ${({ $asOverlay, $open, $side }) =>
    $asOverlay &&
    css`
      position: fixed;
      top: 0;
      bottom: 0;
      ${$side === "right" ? "right: 0;" : "left: 0;"}
      z-index: var(--z-drawer);
      display: flex;
      width: min(300px, 82vw);
      flex-direction: column;
      overflow-y: auto;
      background: var(--bg-surface);
      box-shadow: var(--shadow-lg);
      /* Stops an over-scroll at the end of the drawer from chaining to the
         page underneath it on iOS. */
      overscroll-behavior: contain;
      transition: transform var(--dur) var(--ease);

      /* Open is "none", never "translateX(0)". Any transform value other than
         none makes this element the containing block for its position:fixed
         descendants, which would collapse the ConfirmDialog that MembersSidebar
         renders into the width of the drawer. */
      transform: ${$open
        ? "none"
        : `translateX(${$side === "right" ? "100%" : "-100%"})`};

      /* The panel it wraps sizes itself for the desktop column; in here it
         should fill the drawer instead. */
      > * {
        width: 100%;
        flex: 1;
        min-height: 0;
      }
    `}
`;

/**
 * Wraps a panel that is an inline column on desktop and a slide-over drawer on
 * phones. Always render it, in the same tree slot, on both sides of the
 * breakpoint — swapping between a wrapped and an unwrapped panel would remount
 * the panel on every rotation and throw away whatever it had fetched.
 */
function SlidePanel({ $asOverlay, $open, $side = "left", onClose, children }) {
  return (
    <>
      {$asOverlay && $open && <Backdrop onClick={onClose} />}

      <PanelRoot
        $asOverlay={$asOverlay}
        $open={$open}
        $side={$side}
        // A drawer parked off-screen is still focusable and still read aloud.
        inert={$asOverlay && !$open}
      >
        {children}
      </PanelRoot>
    </>
  );
}

export default SlidePanel;
