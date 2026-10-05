import '../ui/styles.css';
import { App } from './App.js';
import { registerServiceWorker } from './pwa.js';

const app = new App(document.getElementById('view') as HTMLCanvasElement, document.getElementById('ui') as HTMLDivElement);
app.start().catch((e) => {
  console.error('[app] fatal', e);
  app.fatal('Startup failed', [String(e instanceof Error ? e.message : e)]);
});
registerServiceWorker();
(window as unknown as { __app: App }).__app = app;
