// 单元测试里读测试用媒体文件要用到的少量 Node API（项目没装 @types/node）
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:child_process' {
  export function execFileSync(cmd: string, args: string[], opts: { encoding: 'utf8' }): string;
}
declare const __dirname: string;
declare const process: { pid: number };
