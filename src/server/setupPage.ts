// One-time phone setup page for secure LAN mode (served over plain HTTP from the host).
export function renderSetupPage(o: { secureUrl: string; caUrl: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pizzeria Roadrash — Phone setup</title>
<style>
:root{color-scheme:dark;--bg:#07080f;--fg:#e8ecff;--muted:#9aa3c7;--acc:#18e0ff;--mag:#ff2bd6}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:20px}
h1{font-size:22px;margin:0 0 8px;color:var(--acc)}h2{font-size:17px;margin:24px 0 6px;color:var(--mag)}
a.btn{display:inline-block;background:var(--acc);color:#001;padding:12px 18px;border-radius:10px;font-weight:700;text-decoration:none;margin:6px 0}
ol{padding-left:20px}li{margin:6px 0}code{background:#151a33;padding:2px 6px;border-radius:6px}.muted{color:var(--muted)}
</style></head><body>
<h1>Pizzeria Roadrash — secure LAN setup</h1>
<p class="muted">Phone tilt steering, fullscreen and app install need a secure (HTTPS) connection. Do this once per phone. Everything stays on your local network.</p>
<a class="btn" href="${o.caUrl}">1. Download the local certificate</a>
<h2>iPhone / iPad (Safari)</h2>
<ol><li>Tap the button above, then <b>Allow</b>. A “Profile Downloaded” notice appears.</li>
<li>Open <b>Settings → General → VPN &amp; Device Management</b> and install “Pizzeria Roadrash Local CA”.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and switch on full trust for it.</li></ol>
<h2>Android (Chrome)</h2>
<ol><li>Tap the button above to download the certificate.</li>
<li>Open <b>Settings → Security → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate</b> and pick the downloaded file.</li>
<li>If your phone cannot install it, you can still continue past the browser warning; tilt steering usually works, but installing as an app may not.</li></ol>
<h2>2. Join</h2>
<a class="btn" href="${o.secureUrl}">Open the secure game</a>
<p class="muted">Address: <code>${o.secureUrl}</code></p>
</body></html>`;
}
