// H5 renders uni-button as a custom element. Listen for the DOM keyboard event;
// the platform's wrapped component events do not retain KeyboardEvent.key.
let installed = false;
function activateWithKeyboard(event: KeyboardEvent) {
  // #ifdef H5
  const keyEvent = event;
  if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
  const control = (keyEvent.target as HTMLElement | null)?.closest<HTMLElement>('.page uni-button[role="button"]');
  if (!control) return;
  keyEvent.preventDefault();
  if (control.getAttribute('aria-disabled') === 'true' || control.getAttribute('disabled') === 'true' || keyEvent.repeat) return;
  if ((keyEvent.type === 'keydown' && keyEvent.key === 'Enter') || (keyEvent.type === 'keyup' && keyEvent.key === ' ')) control.click();
  // #endif
}

export function installButtonKeyboardSupport() {
  // #ifdef H5
  if (installed || typeof document === 'undefined') return;
  document.addEventListener('keydown',activateWithKeyboard);
  document.addEventListener('keyup',activateWithKeyboard);
  installed = true;
  // #endif
}

// #ifdef H5
if (import.meta.hot) import.meta.hot.dispose(() => {
  document.removeEventListener('keydown',activateWithKeyboard);
  document.removeEventListener('keyup',activateWithKeyboard);
  installed = false;
});
// #endif
