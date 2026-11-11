/**
 * 站点原生暗色的 cookie 开关（如知乎 themeApp=dark）。
 * 这类站点由服务端按 cookie 渲染主题，只改 <html> 属性只能变暗一部分；
 * 所以写上 cookie 让下次加载直接是原生暗色，关闭时还原成用户原来的值。
 */

const ORIG_KEY = 'nativeCookieOrig';
/** 本页当前是否需要这个 cookie；异步还原前再确认一次，避免关了又开时被误还原 */
let wanted = false;

export function readCookie(name: string, src: string = document.cookie): string | null {
  for (const part of src.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) {
      try {
        return decodeURIComponent(part.slice(i + 1));
      } catch {
        return part.slice(i + 1);
      }
    }
  }
  return null;
}

/** 从最宽的可写域（如 .zhihu.com）开始尝试，读回一致即成功；返回写入的域 */
function writeCookie(name: string, value: string | null): string | null {
  const labels = location.hostname.split('.');
  for (let i = Math.max(labels.length - 2, 0); i >= 0; i--) {
    const domain = labels.slice(i).join('.');
    const v = value === null ? '' : encodeURIComponent(value);
    const age = value === null ? 0 : 365 * 24 * 3600;
    document.cookie = `${name}=${v}; domain=.${domain}; path=/; max-age=${age}; SameSite=Lax`;
    if (readCookie(name) === value) return domain;
  }
  return null;
}

function key(name: string): string {
  // 以主域区分，子域（www / zhuanlan）共用一份原值
  return `${name}@${location.hostname.split('.').slice(-2).join('.')}`;
}

/** 原值记录的读写串行执行：开了又马上关（设置还没读到时先按默认开启）时，还原必须排在记录之后，否则会找不到原值 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

type OrigMap = Record<string, string | null>;
async function loadOrig(): Promise<OrigMap> {
  const data = await chrome.storage.local.get(ORIG_KEY);
  return { ...((data[ORIG_KEY] as OrigMap) || {}) };
}

/** 确保 cookie 是目标值（下次加载生效），并记下开启前的原值 */
export function ensureNativeCookie(name: string, value: string): void {
  wanted = true;
  const cur = readCookie(name);
  if (cur === value) return;
  const k = key(name);
  void serial(async () => {
    const map = await loadOrig();
    // 已有记录就不覆盖，保留最早的原值
    if (k in map) return;
    map[k] = cur;
    await chrome.storage.local.set({ [ORIG_KEY]: map });
  }).catch(() => undefined);
  writeCookie(name, value);
}

/**
 * 还原为开启前的值。只在 cookie 仍是我们写的值、且有原值记录时还原。
 * 返回是否真的改回去了（网站下次加载会按浅色渲染）。
 */
export function restoreNativeCookie(name: string, value: string): Promise<boolean> {
  wanted = false;
  if (readCookie(name) !== value) return Promise.resolve(false);
  const k = key(name);
  return serial(async () => {
    const map = await loadOrig();
    if (!(k in map)) return false;
    // 期间可能又被重新开启
    if (wanted || readCookie(name) !== value) return false;
    writeCookie(name, map[k] ?? null);
    delete map[k];
    await chrome.storage.local.set({ [ORIG_KEY]: map });
    return readCookie(name) !== value;
  }).catch(() => false);
}
