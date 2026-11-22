declare module 'mux.js/lib/mp4/transmuxer.js' {
  export class Transmuxer {
    constructor(opts?: { remux?: boolean; keepOriginalTimestamps?: boolean });
    on(ev: 'data', fn: (seg: { initSegment: Uint8Array; data: Uint8Array }) => void): void;
    on(ev: 'done', fn: () => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
}
