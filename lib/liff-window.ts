export interface LiffWindowControl {
  isInClient?: () => boolean;
  closeWindow?: () => void;
}

/** A successful call means the close request was dispatched, not a confirmed OS close. */
export function tryCloseLiffWindow(sdk?: LiffWindowControl): boolean {
  try {
    if (sdk?.isInClient?.() !== true || !sdk.closeWindow) return false;
    sdk.closeWindow();
    return true;
  } catch {
    return false;
  }
}
