/**
 * B 站接口的 WBI 签名：密钥来自 /x/web-interface/nav 返回的两个图片文件名，每天会换。
 * 算法公开（社区整理的 bilibili-API-collect），这里只用于以用户自己的身份请求播放地址。
 */
import { md5 } from '../md5';

const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

const stem = (url: string) => url.slice(url.lastIndexOf('/') + 1).split('.')[0];

export function mixinKey(imgUrl: string, subUrl: string): string {
  const raw = stem(imgUrl) + stem(subUrl);
  return MIXIN.map((i) => raw[i] ?? '').join('').slice(0, 32);
}

export function signWbi(params: Record<string, string | number>, key: string, now = Date.now()): string {
  const all: Record<string, string> = { wts: String(Math.floor(now / 1000)) };
  for (const [k, v] of Object.entries(params)) all[k] = String(v).replace(/[!'()*]/g, '');
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&');
  return `${query}&w_rid=${md5(query + key)}`;
}
