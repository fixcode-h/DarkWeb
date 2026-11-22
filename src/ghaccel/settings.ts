/**
 * GitHub 加速下载的设置与链接改写。
 * 原理：gh-proxy 一类的代理把 “节点地址 + 原始 GitHub 链接” 转发到 GitHub，节点放在 CDN 上，国内下载更快。
 * 单独的存储键，与暗色模式、翻译、阅读增强的设置互不影响。
 */
export type AccelMode = 'add' | 'replace';

export interface AccelSettings {
  enabled: boolean;
  /** add：在原下载入口旁加“加速”按钮；replace：原下载链接直接改走加速 */
  mode: AccelMode;
  /** 选中的节点：内置节点的地址，或 'custom' */
  node: string;
  /** 自建节点地址，node 为 'custom' 时使用 */
  custom: string;
  /** 节点探测失败时改用原链接下载 */
  fallback: boolean;
  /** 私有仓库不显示加速（代理拿不到登录状态，必定失败） */
  skipPrivate: boolean;
}

export interface AccelNode {
  url: string;
  label: string;
}

export const ACCEL_NODES: readonly AccelNode[] = [
  { url: 'https://v6.gh-proxy.org/', label: 'Cloudflare 优选' },
  { url: 'https://gh-proxy.org/', label: '主站' },
  { url: 'https://cdn.gh-proxy.org/', label: 'Fastly' },
  { url: 'https://edgeone.gh-proxy.org/', label: '腾讯 EdgeOne' },
];

export const ACCEL_KEY = 'ghaccel';

export const DEFAULT_ACCEL: AccelSettings = {
  enabled: true,
  mode: 'add',
  node: ACCEL_NODES[0].url,
  custom: '',
  fallback: true,
  skipPrivate: true,
};

/** 规范成 https://host[/path]/ 形式；不合法返回 ''。只接受 https，避免下载走明文 */
export function normalizeNodeUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return '';
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    return `https://${u.host}${path}`;
  } catch {
    return '';
  }
}

export function normalizeAccel(v: unknown): AccelSettings {
  const o = typeof v === 'object' && v ? (v as Record<string, unknown>) : {};
  const custom = normalizeNodeUrl(o.custom);
  const builtin = ACCEL_NODES.some((n) => n.url === o.node);
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_ACCEL.enabled,
    mode: o.mode === 'replace' ? 'replace' : 'add',
    node: builtin ? (o.node as string) : o.node === 'custom' && custom ? 'custom' : DEFAULT_ACCEL.node,
    custom,
    fallback: typeof o.fallback === 'boolean' ? o.fallback : DEFAULT_ACCEL.fallback,
    skipPrivate: typeof o.skipPrivate === 'boolean' ? o.skipPrivate : DEFAULT_ACCEL.skipPrivate,
  };
}

/** 当前生效的节点地址 */
export function activeNode(s: AccelSettings): string {
  return s.node === 'custom' ? s.custom || DEFAULT_ACCEL.node : s.node;
}

/** 节点的简短显示名：域名 */
export function nodeHost(node: string): string {
  try {
    return new URL(node).host;
  } catch {
    return node;
  }
}

const OWNER_REPO = String.raw`[\w.-]+/[\w.-]+`;
/** github.com 上可以加速的链接：源码包、Release 附件、Raw 文件、git 仓库地址 */
const GITHUB_PATHS = [
  new RegExp(`^/${OWNER_REPO}/archive/.+\\.(zip|tar\\.gz)$`),
  new RegExp(`^/${OWNER_REPO}/releases/download/.+`),
  new RegExp(`^/${OWNER_REPO}/(raw|blob)/.+`),
  new RegExp(`^/${OWNER_REPO}\\.git$`),
];
const RAW_HOSTS = new Set(['raw.githubusercontent.com', 'gist.githubusercontent.com']);

/**
 * 把 GitHub 链接整理成可加速的绝对地址；不能加速返回 null。
 * 带 token 等查询参数的链接（私有内容的临时授权）不加速，免得把凭据交给第三方代理。
 */
export function accelerable(href: string, base = 'https://github.com/'): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.search || u.username || u.password) return null;
  if (u.host === 'github.com') {
    if (!GITHUB_PATHS.some((re) => re.test(u.pathname))) return null;
  } else if (!RAW_HOSTS.has(u.host)) return null;
  return `https://${u.host}${u.pathname}`;
}

/** 加速地址 = 节点 + 原始地址；不能加速的链接原样返回 null */
export function proxify(href: string, node: string, base?: string): string | null {
  const target = accelerable(href, base);
  return target ? `${node}${target}` : null;
}
