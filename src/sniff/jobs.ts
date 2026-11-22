/** 后台和离屏文档之间的消息 */

export type JobKind = 'hls' | 'dash' | 'tracks';

export interface Job {
  id: string;
  kind: JobKind;
  /** hls / dash：播放列表地址；tracks：每条轨道一个完整文件（如 B 站的视频 m4s + 音频 m4s） */
  url: string;
  tracks?: string[];
  /** 每条轨道的备用地址（B 站的 backupUrl），主地址失败时依次换 */
  backups?: string[][];
  /** 不带扩展名 */
  name: string;
  concurrency: number;
}

export type Stage = 'queued' | 'download' | 'merge' | 'save' | 'done' | 'error' | 'canceled';

export interface Task {
  id: string;
  tabId: number;
  name: string;
  /** 文件名（含扩展名），保存后才确定 */
  file?: string;
  stage: Stage;
  done: number;
  total: number;
  bytes: number;
  /** 字节 / 秒 */
  speed: number;
  error?: string;
  note?: string;
  downloadId?: number;
  started: number;
  finished?: number;
}

export type OffscreenMsg =
  | { target: 'sniff-offscreen'; type: 'run'; job: Job }
  | { target: 'sniff-offscreen'; type: 'cancel'; id: string }
  | { target: 'sniff-offscreen'; type: 'revoke'; url: string }
  | { target: 'sniff-offscreen'; type: 'ping' };

export type FromOffscreen =
  | { type: 'sniff:progress'; id: string; stage: Stage; done: number; total: number; bytes: number }
  | { type: 'sniff:hosts'; id: string; hosts: string[] }
  | { type: 'sniff:save'; id: string; files: { url: string; ext: string; suffix?: string }[]; note?: string }
  | { type: 'sniff:error'; id: string; error: string; canceled?: boolean };
