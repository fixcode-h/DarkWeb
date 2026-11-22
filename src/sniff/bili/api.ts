/**
 * 在 B 站页面里（内容脚本的隔离环境）调接口：请求带的是页面自己的来源和用户的登录状态，
 * 所以拿到的清晰度就是这个账号本来能看的。由后台用 executeScript 注入，挂在隔离环境的 globalThis.__drakBili 上，页面脚本看不到。
 */
import { mixinKey, signWbi } from './wbi';
import { parsePlayurl, type BiliStreams } from './parse';

export interface BiliPart {
  cid: number;
  /** 分 P 序号，番剧是第几集 */
  index: number;
  title: string;
  bvid?: string;
  epId?: number;
}

export interface BiliMedia {
  kind: 'video' | 'bangumi';
  title: string;
  owner?: string;
  cover?: string;
  parts: BiliPart[];
  /** 当前页面播的是哪一个（parts 里的下标） */
  current: number;
  streams: BiliStreams;
}

let wbiKey: { key: string; at: number } | null = null;

async function api(url: string): Promise<any> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`B 站接口 HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 0) throw new Error(`B 站接口返回：${j.message ?? j.code}`);
  return j.data ?? j.result;
}

async function key(): Promise<string> {
  if (wbiKey && Date.now() - wbiKey.at < 3600_000) return wbiKey.key;
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
  const j = await res.json();
  const img = j.data?.wbi_img;
  if (!img) throw new Error('拿不到 WBI 密钥');
  wbiKey = { key: mixinKey(img.img_url, img.sub_url), at: Date.now() };
  return wbiKey.key;
}

async function playurl(bvid: string, cid: number): Promise<BiliStreams> {
  const q = signWbi({ bvid, cid, qn: 127, fnval: 4048, fnver: 0, fourk: 1 }, await key());
  return parsePlayurl(await api(`https://api.bilibili.com/x/player/wbi/playurl?${q}`));
}

async function pgcPlayurl(epId: number, cid: number): Promise<BiliStreams> {
  return parsePlayurl(await api(`https://api.bilibili.com/pgc/player/web/playurl?ep_id=${epId}&cid=${cid}&qn=127&fnval=4048&fnver=0&fourk=1`));
}

export async function streamsFor(part: BiliPart): Promise<BiliStreams> {
  return part.epId ? pgcPlayurl(part.epId, part.cid) : playurl(part.bvid!, part.cid);
}

/** 当前页面地址 → 视频信息和当前分 P 的播放地址 */
export async function resolve(href: string): Promise<BiliMedia | null> {
  const u = new URL(href);
  const bv = /\/video\/(BV[0-9A-Za-z]{10})/.exec(u.pathname)?.[1];
  if (bv) {
    const v = await api(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`);
    const parts: BiliPart[] = (v.pages ?? []).map((p: any) => ({ cid: p.cid, index: p.page, title: p.part ?? '', bvid: bv }));
    if (!parts.length) parts.push({ cid: v.cid, index: 1, title: '', bvid: bv });
    const p = Number(u.searchParams.get('p')) || 1;
    const current = Math.max(0, parts.findIndex((x) => x.index === p));
    return { kind: 'video', title: v.title, owner: v.owner?.name, cover: v.pic?.replace(/^http:/, 'https:'), parts, current, streams: await streamsFor(parts[current]) };
  }
  const ep = /\/bangumi\/play\/ep(\d+)/.exec(u.pathname)?.[1];
  const ss = /\/bangumi\/play\/ss(\d+)/.exec(u.pathname)?.[1];
  if (ep || ss) {
    const s = await api(`https://api.bilibili.com/pgc/view/web/season?${ep ? `ep_id=${ep}` : `season_id=${ss}`}`);
    const eps: any[] = s.episodes ?? [];
    const parts: BiliPart[] = eps.map((e, i) => ({ cid: e.cid, index: i + 1, title: [e.title, e.long_title].filter(Boolean).join(' '), epId: e.ep_id ?? e.id, bvid: e.bvid }));
    if (!parts.length) return null;
    const current = Math.max(0, ep ? parts.findIndex((x) => String(x.epId) === ep) : 0);
    return { kind: 'bangumi', title: s.season_title ?? s.title, cover: (s.cover as string | undefined)?.replace(/^http:/, 'https:'), parts, current, streams: await streamsFor(parts[current]) };
  }
  return null;
}

/** CC 字幕列表（多数需要登录） */
export async function subtitles(part: BiliPart): Promise<{ lang: string; label: string; url: string }[]> {
  if (!part.bvid) return [];
  const q = signWbi({ bvid: part.bvid, cid: part.cid }, await key());
  const d = await api(`https://api.bilibili.com/x/player/wbi/v2?${q}`);
  return (d.subtitle?.subtitles ?? [])
    .filter((s: any) => s.subtitle_url)
    .map((s: any) => ({ lang: s.lan, label: s.lan_doc, url: String(s.subtitle_url).replace(/^\/\//, 'https://') }));
}

export async function subtitleBody(url: string): Promise<{ from: number; to: number; content: string }[]> {
  const res = await fetch(url);
  return (await res.json()).body ?? [];
}
