/**
 * WebM（Matroska）音视频合并：把只有视频的 WebM 和只有音频的 WebM 合成一个文件，只换封装、不重新编码。
 * 也能处理边播边录拿到的流（开头一段初始化数据 + 一串 Cluster，Cluster 可能是未知长度、可能重复出现初始化数据）。
 * 做法：抄第一份的 EBML 头和 Info，合并所有 Tracks 并重新编号，按时间把各文件的 Cluster 交错排好，改掉块里的轨道号。
 */
const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  ContentEncodings: 0x6d80,
  ContentEncryption: 0x5035,
  Cluster: 0x1f43b675,
  Duration: 0x4489,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Position: 0xa7,
  PrevSize: 0xab,
} as const;

/** Segment 下一层的元素：遇到它们说明未知长度的 Cluster 结束了 */
const LEVEL1 = new Set([0x114d9b74, ID.Info, ID.Tracks, ID.Cluster, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0x1941a469, ID.EBML, ID.Segment]);

interface El {
  id: number;
  /** 数据开始位置 */
  start: number;
  /** 数据结束位置（未知长度时为 -1） */
  end: number;
  /** 元素头开始位置 */
  head: number;
}

function readId(b: Uint8Array, o: number): [number, number] | null {
  const first = b[o];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || o + len > b.length) return null;
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[o + i];
  return [v, len];
}

/** 长度：返回 [值, 字节数]，全 1 表示未知长度，值为 -1 */
function readSize(b: Uint8Array, o: number): [number, number] | null {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (o + len > b.length) return null;
  let v = first & (0xff >> len);
  let ones = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) ones = false;
  }
  return [ones ? -1 : v, len];
}

function readEl(b: Uint8Array, o: number): El | null {
  const id = readId(b, o);
  if (!id) return null;
  const size = readSize(b, o + id[1]);
  if (!size) return null;
  const start = o + id[1] + size[1];
  return { id: id[0], start, end: size[0] < 0 ? -1 : Math.min(start + size[0], b.length), head: o };
}

function children(b: Uint8Array, start: number, end: number): El[] {
  const out: El[] = [];
  let o = start;
  while (o < end) {
    const e = readEl(b, o);
    if (!e || e.end < 0) break;
    out.push(e);
    o = e.end;
  }
  return out;
}

function uint(b: Uint8Array, e: El): number {
  let v = 0;
  for (let i = e.start; i < e.end; i++) v = v * 256 + b[i];
  return v;
}

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
}

/** 元素头：ID + 8 字节长度 */
function header(id: number, size: number): Uint8Array {
  const s = [0x01];
  for (let i = 6; i >= 0; i--) s.push(Math.floor(size / 2 ** (8 * i)) & 0xff);
  return new Uint8Array([...idBytes(id), ...s]);
}

function element(id: number, payload: Uint8Array | number[]): Uint8Array {
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const h = header(id, p.length);
  const out = new Uint8Array(h.length + p.length);
  out.set(h);
  out.set(p, h.length);
  return out;
}

function uintBytes(v: number, n = 0): number[] {
  const out: number[] = [];
  for (let x = v; x > 0 || out.length < Math.max(n, 1); x = Math.floor(x / 256)) out.unshift(x & 0xff);
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

interface Cluster {
  /** 纳秒 */
  time: number;
  /** 最后一个块的时间（纳秒） */
  last: number;
  input: number;
  parts: Uint8Array[];
  size: number;
}

interface Parsed {
  ebml?: Uint8Array;
  info?: Uint8Array;
  scale: number;
  /** TrackEntry 的原始字节和原轨道号 */
  tracks: { number: number; bytes: Uint8Array; entry: El }[];
  clusters: Cluster[];
}

/** 改块里的轨道号（第一个 vint）；新旧号都小于 127，长度不变，原地改 */
function patchBlock(b: Uint8Array, at: number, map: Map<number, number>): void {
  if (!(b[at] & 0x80)) throw new Error('轨道号过大，暂不支持');
  const n = map.get(b[at] & 0x7f);
  if (n !== undefined) b[at] = 0x80 | n;
}

function parse(b: Uint8Array, input: number, map: (n: number) => number): Parsed {
  const out: Parsed = { scale: 1_000_000, tracks: [], clusters: [] };
  const trackMap = new Map<number, number>();
  const seen = new Set<number>();
  let o = 0;
  while (o < b.length) {
    const e = readEl(b, o);
    if (!e) break;
    if (e.id === ID.EBML) {
      out.ebml ??= b.subarray(e.head, e.end);
      o = e.end;
    } else if (e.id === ID.Segment) {
      // 进入 Segment，逐个看下一层
      o = e.start;
    } else if (e.id === ID.Info) {
      out.info ??= b.subarray(e.head, e.end);
      const ts = children(b, e.start, e.end).find((c) => c.id === ID.TimecodeScale);
      if (ts && out.tracks.length === 0) out.scale = uint(b, ts);
      o = e.end;
    } else if (e.id === ID.Tracks) {
      for (const t of children(b, e.start, e.end).filter((c) => c.id === ID.TrackEntry)) {
        const kids = children(b, t.start, t.end);
        const enc = kids.find((c) => c.id === ID.ContentEncodings);
        if (enc && children(b, enc.start, enc.end).some((c) => children(b, c.start, c.end).some((x) => x.id === ID.ContentEncryption))) {
          throw new Error('加密内容（DRM），无法下载');
        }
        const num = kids.find((c) => c.id === ID.TrackNumber);
        const n = num ? uint(b, num) : 1;
        if (!trackMap.has(n)) {
          trackMap.set(n, map(n));
          out.tracks.push({ number: n, bytes: b, entry: t });
        }
      }
      o = e.end;
    } else if (e.id === ID.Cluster) {
      // 未知长度：一直读到下一个第一层元素
      let end = e.end;
      if (end < 0) {
        let p = e.start;
        while (p < b.length) {
          const c = readEl(b, p);
          if (!c || LEVEL1.has(c.id) || c.end < 0) break;
          p = c.end;
        }
        end = p;
      }
      const kids = children(b, e.start, end);
      const tc = kids.find((c) => c.id === ID.Timecode);
      const time = (tc ? uint(b, tc) : 0) * out.scale;
      // 边播边录时同一段可能被追加两次（拖动、切换清晰度），按时间去重
      if (!seen.has(time)) {
        seen.add(time);
        const parts: Uint8Array[] = [];
        let last = time;
        const block = (at: number) => {
          patchBlock(b, at, trackMap);
          // 轨道号后面是相对 Cluster 的时间（有符号 16 位）
          const rel = ((b[at + 1] << 8) | b[at + 2]) << 16 >> 16;
          last = Math.max(last, time + rel * out.scale);
        };
        for (const c of kids) {
          if (c.id === ID.Position || c.id === ID.PrevSize) continue;
          if (c.id === ID.SimpleBlock) block(c.start);
          else if (c.id === ID.BlockGroup) {
            const blk = children(b, c.start, c.end).find((x) => x.id === ID.Block);
            if (blk) block(blk.start);
          }
          parts.push(b.subarray(c.head, c.end));
        }
        out.clusters.push({ time, last, input, parts, size: parts.reduce((n, p) => n + p.length, 0) });
      }
      o = end;
    } else {
      // SeekHead、Cues、Tags 等：合并后位置都变了，丢掉
      if (e.end < 0) break;
      o = e.end;
    }
  }
  return out;
}

/** 重新生成一个 TrackEntry：换轨道号和 UID，其余照抄 */
function rebuildEntry(b: Uint8Array, t: El, number: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const c of children(b, t.start, t.end)) {
    if (c.id === ID.TrackNumber) parts.push(element(ID.TrackNumber, uintBytes(number)));
    else if (c.id === ID.TrackUID) parts.push(element(ID.TrackUID, uintBytes(number, 8)));
    else parts.push(b.subarray(c.head, c.end));
  }
  return element(ID.TrackEntry, concat(parts));
}

function rebuildInfo(info: Uint8Array | undefined, duration: number): Uint8Array {
  const dur = new Uint8Array(8);
  new DataView(dur.buffer).setFloat64(0, duration);
  const parts: Uint8Array[] = [];
  if (info) {
    const e = readEl(info, 0)!;
    for (const c of children(info, e.start, e.end)) if (c.id !== ID.Duration) parts.push(info.subarray(c.head, c.end));
  } else parts.push(element(ID.TimecodeScale, uintBytes(1_000_000)));
  parts.push(element(ID.Duration, dur));
  return element(ID.Info, concat(parts));
}

export async function mergeWebm(inputs: Blob[]): Promise<Blob> {
  let next = 1;
  const parsed: Parsed[] = [];
  for (const [i, blob] of inputs.entries()) {
    const b = new Uint8Array(await blob.arrayBuffer());
    const base = next;
    const p = parse(b, i, (n) => {
      const v = base + n - 1;
      next = Math.max(next, v + 1);
      return v;
    });
    if (!p.ebml || !p.tracks.length) throw new Error('不是有效的 WebM 文件');
    parsed.push(p);
  }
  const scale = parsed[0].scale;
  if (parsed.some((p) => p.scale !== scale)) throw new Error('几个 WebM 的时间刻度不一样，暂不支持合并');
  if (next > 127) throw new Error('轨道太多');

  const entries: Uint8Array[] = [];
  let n = 1;
  for (const p of parsed) for (const t of p.tracks) entries.push(rebuildEntry(t.bytes, t.entry, n++));
  // 按时间交错；同一时间视频（先传入的）在前
  const clusters = parsed.flatMap((p) => p.clusters).sort((a, b) => a.time - b.time || a.input - b.input);
  const unknown = new Uint8Array([...idBytes(ID.Segment), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const out: BlobPart[] = [parsed[0].ebml!, unknown];
  // Info 照抄，但时长按实际内容重写（分段下载、边播边录的原始数据里没有时长，播放器就拖不了进度条）
  const end = clusters.reduce((m, c) => Math.max(m, c.last), 0);
  out.push(rebuildInfo(parsed[0].info, end / scale));
  out.push(element(ID.Tracks, concat(entries)));
  for (const c of clusters) out.push(header(ID.Cluster, c.size), ...c.parts);
  return new Blob(out as BlobPart[], { type: 'video/webm' });
}

/** 看开头是不是 WebM（EBML 头） */
export function isWebm(head: Uint8Array): boolean {
  return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
}
