/**
 * 把几条分片 MP4（fMP4）轨道合成一个文件：DASH / B 站的视频轨 + 音频轨，或 HLS 里分开的音频。
 *
 * 只换封装不碰编码：重写 moov（多条 trak、mvex 里的 trex，重新编号 track_ID），
 * 每个 moof 改掉 track_ID 和序号后原样搬过去，mdat 直接用 Blob 切片引用，不读进内存，几个 G 的文件也不会爆。
 * 输出是 fMP4，按每个分片的解码时间交错排列，常见播放器（浏览器、VLC、mpv、系统播放器）都能播。
 */

export interface Box {
  type: string;
  start: number;
  size: number;
  /** 盒子内容（不含头）的起点 */
  body: number;
}

const te = new TextDecoder('latin1');
const typeAt = (b: Uint8Array, o: number) => te.decode(b.subarray(o, o + 4));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

function setU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}
function setU64(b: Uint8Array, o: number, v: number): void {
  setU32(b, o, Math.floor(v / 2 ** 32));
  setU32(b, o + 4, v >>> 0);
}

/** 内存里一段数据的子盒子 */
export function children(b: Uint8Array, start = 0, end = b.length): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    let head = 8;
    if (size === 1) {
      size = u64(b, o + 8);
      head = 16;
    } else if (size === 0) size = end - o;
    if (size < head || o + size > end) break;
    out.push({ type: typeAt(b, o + 4), start: o, size, body: o + head });
    o += size;
  }
  return out;
}

/** 文件顶层的盒子：只读每个盒子的头 */
export async function scan(blob: Blob): Promise<Box[]> {
  const out: Box[] = [];
  let o = 0;
  while (o + 8 <= blob.size) {
    const h = new Uint8Array(await blob.slice(o, o + 16).arrayBuffer());
    let size = u32(h, 0);
    let head = 8;
    if (size === 1) {
      size = u64(h, 8);
      head = 16;
    } else if (size === 0) size = blob.size - o;
    if (size < head || o + size > blob.size) break;
    out.push({ type: typeAt(h, 4), start: o, size, body: o + head });
    o += size;
  }
  return out;
}

const read = async (blob: Blob, box: Box) => new Uint8Array(await blob.slice(box.start, box.start + box.size).arrayBuffer());

function find(b: Uint8Array, path: string[], start = 0, end = b.length): Box | undefined {
  let range: [number, number] = [start, end];
  let found: Box | undefined;
  for (const t of path) {
    found = children(b, range[0], range[1]).find((x) => x.type === t);
    if (!found) return undefined;
    range = [found.body, found.start + found.size];
  }
  return found;
}

/** trak 的 track_ID 在 tkhd 里的位置 */
function tkhdIdOffset(b: Uint8Array, tkhd: Box): number {
  return tkhd.body + 4 + (b[tkhd.body] === 1 ? 16 : 8);
}

function mdhdTimescale(b: Uint8Array, trak: Box): number {
  const mdhd = find(b, ['mdia', 'mdhd'], trak.body, trak.start + trak.size);
  if (!mdhd) return 1;
  return u32(b, mdhd.body + 4 + (b[mdhd.body] === 1 ? 16 : 8)) || 1;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  setU32(out, 0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 遇到这些盒子说明上一个分片结束了 */
const FRAG_START = new Set(['styp', 'sidx', 'ssix', 'emsg', 'prft', 'mfra', 'moov', 'ftyp']);

interface Track {
  trak: Uint8Array;
  trex?: Uint8Array;
  oldId: number;
  newId: number;
  timescale: number;
}

interface Fragment {
  input: number;
  moof: Uint8Array;
  mdats: Box[];
  time: number;
  order: number;
}

export interface MergeInfo {
  tracks: number;
  fragments: number;
}

/** 合并若干条 fMP4 轨道；只有一条时也会规范化（去掉 sidx 等索引盒子） */
export async function mergeFmp4(inputs: Blob[], info?: MergeInfo): Promise<Blob> {
  let ftyp: Uint8Array | undefined;
  let mvhd: Uint8Array | undefined;
  const tracks: Track[] = [];
  const frags: Fragment[] = [];
  const idMaps: Map<number, Track>[] = [];
  let nextId = 1;
  let order = 0;
  const seen = new Set<string>();

  for (let i = 0; i < inputs.length; i++) {
    const blob = inputs[i];
    const boxes = await scan(blob);
    const map = new Map<number, Track>();
    idMaps.push(map);
    const moovBox = boxes.find((b) => b.type === 'moov');
    if (!moovBox) throw new Error('缺少 moov：不是完整的分片 MP4');
    const moov = await read(blob, moovBox);
    const ftypBox = boxes.find((b) => b.type === 'ftyp');
    if (!ftyp && ftypBox) ftyp = await read(blob, ftypBox);
    const kidsOfMoov = children(moov, 8);
    if (kidsOfMoov.some((k) => k.type === 'pssh')) throw new Error('加密内容（DRM），无法下载');
    if (!mvhd) {
      const m = kidsOfMoov.find((k) => k.type === 'mvhd');
      if (m) mvhd = moov.slice(m.start, m.start + m.size);
    }
    const mvex = kidsOfMoov.find((k) => k.type === 'mvex');
    const trexes = mvex ? children(moov, mvex.body, mvex.start + mvex.size).filter((k) => k.type === 'trex') : [];
    for (const t of kidsOfMoov.filter((k) => k.type === 'trak')) {
      const tkhd = find(moov, ['tkhd'], t.body, t.start + t.size);
      if (!tkhd) continue;
      if (find(moov, ['mdia', 'minf', 'stbl', 'stsd'], t.body, t.start + t.size) && /encv|enca/.test(te.decode(moov.subarray(t.start, t.start + t.size)))) {
        throw new Error('加密内容（DRM），无法下载');
      }
      const oldId = u32(moov, tkhdIdOffset(moov, tkhd));
      const trak = moov.slice(t.start, t.start + t.size);
      setU32(trak, tkhdIdOffset(moov, tkhd) - t.start, nextId);
      const trexBox = trexes.find((x) => u32(moov, x.body + 4) === oldId);
      let trex: Uint8Array | undefined;
      if (trexBox) {
        trex = moov.slice(trexBox.start, trexBox.start + trexBox.size);
        setU32(trex, trexBox.body - trexBox.start + 4, nextId);
      }
      const tr: Track = { trak, trex, oldId, newId: nextId++, timescale: mdhdTimescale(moov, t) };
      tracks.push(tr);
      map.set(oldId, tr);
    }

    let cur: Fragment | null = null;
    for (const b of boxes) {
      if (b.type === 'moof') {
        const moof = await read(blob, b);
        let time = NaN;
        const traf = find(moof, ['traf'], 8);
        if (traf) {
          const tfhd = find(moof, ['tfhd'], traf.body, traf.start + traf.size);
          const tfdt = find(moof, ['tfdt'], traf.body, traf.start + traf.size);
          const tr = tfhd ? map.get(u32(moof, tfhd.body + 4)) : undefined;
          if (tfdt) time = (moof[tfdt.body] === 1 ? u64(moof, tfdt.body + 4) : u32(moof, tfdt.body + 4)) / (tr?.timescale ?? 1);
        }
        // 边播边录时同一个分片可能被追加了两次（拖动进度、切换清晰度），同一轨同一时间只留第一个
        const key = `${i}|${traf ? u32(moof, (find(moof, ['tfhd'], traf.body, traf.start + traf.size)?.body ?? 0) + 4) : 0}|${time}`;
        if (Number.isFinite(time) && seen.has(key)) {
          cur = null;
          continue;
        }
        seen.add(key);
        cur = { input: i, moof, mdats: [], time, order: order++ };
        // 记下原始位置，用来换算 base_data_offset
        (cur as Fragment & { origin: number }).origin = b.start;
        frags.push(cur);
      } else if (FRAG_START.has(b.type)) cur = null;
      // moof 后面直到下一个分片之前的盒子都要原样跟着（中间若有 free 之类，去掉会打乱 trun 的偏移）
      else if (cur) cur.mdats.push(b);
    }
  }
  if (!tracks.length) throw new Error('没有找到音视频轨道');

  // 按解码时间交错；时间读不到时保持原顺序
  frags.sort((a, b) => (Number.isFinite(a.time) && Number.isFinite(b.time) && a.time !== b.time ? a.time - b.time : a.order - b.order));

  if (mvhd) setU32(mvhd, mvhd.length - 4, nextId);
  const trexAll = tracks.filter((t) => t.trex).map((t) => t.trex!);
  const moovOut = box('moov', ...(mvhd ? [mvhd] : []), ...tracks.map((t) => t.trak), ...(trexAll.length ? [box('mvex', ...trexAll)] : []));
  const head = [ftyp ?? box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x6d, 0x70, 0x34, 0x31])), moovOut];
  const parts: BlobPart[] = [...head] as BlobPart[];
  let pos = head.reduce((n, p) => n + p.length, 0);
  let seq = 1;
  for (const f of frags) {
    const m = f.moof;
    const delta = pos - (f as Fragment & { origin: number }).origin;
    for (const k of children(m, 8)) {
      if (k.type === 'mfhd') setU32(m, k.body + 4, seq++);
      if (k.type !== 'traf') continue;
      const tfhd = find(m, ['tfhd'], k.body, k.start + k.size);
      if (!tfhd) continue;
      const flags = u32(m, tfhd.body) & 0xffffff;
      const old = u32(m, tfhd.body + 4);
      const tr = idMaps[f.input].get(old);
      if (tr) setU32(m, tfhd.body + 4, tr.newId);
      if (flags & 0x1) setU64(m, tfhd.body + 8, u64(m, tfhd.body + 8) + delta);
    }
    parts.push(m as BlobPart);
    pos += m.length;
    // mdat 必须紧跟着搬（trun 的 data_offset 相对 moof 起点）
    const src = inputs[f.input];
    for (const d of f.mdats) {
      parts.push(src.slice(d.start, d.start + d.size));
      pos += d.size;
    }
  }
  if (info) {
    info.tracks = tracks.length;
    info.fragments = frags.length;
  }
  return new Blob(parts, { type: 'video/mp4' });
}
