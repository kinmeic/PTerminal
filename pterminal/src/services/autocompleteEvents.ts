const DISMISS_EVENT = 'pterminal-autocomplete-dismiss';

export function dismissTerminalAutocomplete() {
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

export function onTerminalAutocompleteDismiss(listener: () => void): () => void {
  window.addEventListener(DISMISS_EVENT, listener);
  return () => window.removeEventListener(DISMISS_EVENT, listener);
}
