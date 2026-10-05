// PWA: service worker registration and install prompt capture.
let deferred: (Event & { prompt: () => Promise<void> }) | null = null;
const listeners: (() => void)[] = [];

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as Event & { prompt: () => Promise<void> };
  for (const l of listeners) l();
});

export function canInstall(): boolean {
  return deferred !== null;
}

export function onInstallAvailable(l: () => void): void {
  listeners.push(l);
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  deferred = null;
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) {
    console.info('[pwa] service worker needs a secure context (use npm run dev:secure for phones)');
    return;
  }
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('[pwa] service worker registration failed', e));
}
