import type { ImageClass } from './image-stats';

export type Request =
  | { type: 'fetch-css'; url: string }
  | { type: 'analyze-image'; url: string; dimImages: boolean }
  | { type: 'invert-image'; url: string }
  | { type: 'diag' }
  | { type: 'reapply' };

export interface FetchCssResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  cls?: ImageClass;
  error?: string;
}

export interface InvertResponse {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface Diagnostics {
  host: string;
  mode: string;
  reason: string;
  sheets: number;
  rules: number;
  shadowRoots: number;
  images: { keep: number; invert: number; dim: number };
  errors: number;
  timings: Record<string, number>;
  brightRatio: number | null;
  frame: 'top' | 'sub';
}
