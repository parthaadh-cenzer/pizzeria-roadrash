// Minimal DOM helpers for the HTML/CSS overlay UI (no framework).
type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string;
  id?: string;
  style?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  maxlength?: number;
  disabled?: boolean;
  html?: string;
  role?: string;
  'aria-label'?: string;
  'data-id'?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onkeydown?: (e: KeyboardEvent) => void;
  onpointerdown?: (e: PointerEvent) => void;
  onpointerup?: (e: PointerEvent) => void;
  [k: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function toggle(el: Element | null, cls: string, on: boolean): void {
  if (el) el.classList.toggle(cls, on);
}

export interface Screen {
  el: HTMLElement;
  update?(dt: number): void;
  dispose?(): void;
}
