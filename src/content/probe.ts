/**
 * Page Probe：在页面世界（MAIN world）document_start 时运行，早于页面脚本。
 * 只做通知，不改变任何原生方法的行为：先调用原方法、原样返回，通知部分的异常全部吞掉。
 * 用 Proxy 包装，Function.prototype.toString 仍返回 native code，不会被风控脚本当成篡改。
 */
(() => {
  const w = window as unknown as { __drakProbe?: boolean };
  if (w.__drakProbe) return;
  w.__drakProbe = true;

  const SHEETS_EVENT = 'drak-sheets';
  const SHADOW_EVENT = 'drak-shadow';
  let pending = false;

  const notifySheets = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      try {
        document.dispatchEvent(new CustomEvent(SHEETS_EVENT));
      } catch {
        /* ignore */
      }
    });
  };

  const wrapMethod = <T extends object>(proto: T, name: keyof T, after: (self: unknown, args: unknown[]) => void) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as (...args: unknown[]) => unknown;
    const proxy = new Proxy(original, {
      apply(target, self, args) {
        const result = Reflect.apply(target, self, args);
        try {
          after(self, args);
        } catch {
          /* 通知失败不影响页面 */
        }
        return result;
      },
    });
    Object.defineProperty(proto, name, { ...desc, value: proxy });
  };

  const wrapSetter = (proto: object, name: string, after: (self: unknown) => void) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || !desc.set) return;
    const set = desc.set;
    const proxy = new Proxy(set, {
      apply(target, self, args) {
        const result = Reflect.apply(target, self, args);
        try {
          after(self);
        } catch {
          /* ignore */
        }
        return result;
      },
    });
    Object.defineProperty(proto, name, { ...desc, set: proxy });
  };

  try {
    wrapMethod(Element.prototype, 'attachShadow', (host) => {
      const el = host as Element;
      // 非自定义元素做个标记，方便内容脚本在子树扫描时找到宿主
      if (!el.localName.includes('-')) el.setAttribute('data-drak-sr', '');
      if (el.isConnected) {
        queueMicrotask(() => {
          try {
            el.dispatchEvent(new CustomEvent(SHADOW_EVENT, { bubbles: true, composed: true }));
          } catch {
            /* ignore */
          }
        });
      }
    });
    const sheetProto = CSSStyleSheet.prototype;
    wrapMethod(sheetProto, 'insertRule', notifySheets);
    wrapMethod(sheetProto, 'deleteRule', notifySheets);
    wrapMethod(sheetProto, 'replaceSync', notifySheets);
    wrapMethod(sheetProto, 'addRule' as keyof CSSStyleSheet, notifySheets);
    // replace() 是异步的，等它完成后再通知
    wrapMethod(sheetProto, 'replace', (_self, _args) => {
      setTimeout(notifySheets, 0);
    });
    wrapSetter(Document.prototype, 'adoptedStyleSheets', notifySheets);
    wrapSetter(ShadowRoot.prototype, 'adoptedStyleSheets', notifySheets);
  } catch {
    /* 探针失败时内容脚本仍可依靠 MutationObserver 工作 */
  }
})();
