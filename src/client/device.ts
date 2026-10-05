// Device capability detection (mobile vs desktop, secure context, sensors, fullscreen).
import type { GraphicsPreset } from '../shared/ids.js';

export interface DeviceInfo {
  mobile: boolean;
  touch: boolean;
  ios: boolean;
  android: boolean;
  secure: boolean;
  standalone: boolean;
  orientationApi: boolean;
  motionPermissionApi: boolean;
  fullscreenApi: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  gpu: string;
}

export function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const mobile = ios || android || (coarse && touch && Math.min(screen.width, screen.height) < 900);
  let webgl2 = false;
  let maxTextureSize = 0;
  let gpu = 'unknown';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
  return {
    mobile,
    touch,
    ios,
    android,
    secure: window.isSecureContext,
    standalone: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
    orientationApi: 'DeviceOrientationEvent' in window,
    motionPermissionApi: !!DOE && typeof DOE.requestPermission === 'function',
    fullscreenApi: !!(document.documentElement.requestFullscreen || (document.documentElement as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen),
    webgl2,
    maxTextureSize,
    gpu,
  };
}

export function autoPreset(d: DeviceInfo): GraphicsPreset {
  if (d.mobile) return 'MOBILE';
  if (/intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe/i.test(d.gpu)) return 'MEDIUM';
  return 'HIGH';
}
