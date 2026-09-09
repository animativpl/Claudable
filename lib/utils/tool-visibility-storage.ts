const STORAGE_KEY = 'showToolCalls';

export function readShowToolCalls(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(STORAGE_KEY) === 'true';
}

export function writeShowToolCalls(show: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, String(show));
}
