const STORAGE_KEY = 'selectedModel';

export function readStoredModel(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function writeStoredModel(modelId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, modelId);
}
