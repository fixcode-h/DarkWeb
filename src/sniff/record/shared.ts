/** 边播边录：页面环境（hook）和扩展隔离环境（recorder）之间用 postMessage 通信 */
export const REC_FLAG = 'drak-rec';
export const REC_CHANNEL = '__drakRec';

export type HookMsg =
  | { [REC_CHANNEL]: 1; t: 'sb'; id: number; mime: string }
  | { [REC_CHANNEL]: 1; t: 'data'; id: number; buf: ArrayBuffer }
  | { [REC_CHANNEL]: 1; t: 'drm' };

/** 只有被点了“边播边录”的标签页（sessionStorage 里有标记）才启用；别的页面这两个脚本什么都不做 */
export function armed(): boolean {
  try {
    return sessionStorage.getItem(REC_FLAG) === '1';
  } catch {
    return false;
  }
}
