/** 注入到 B 站页面隔离环境的入口：把接口函数挂到 globalThis.__drakBili，后台再用 executeScript 调用 */
import { resolve, streamsFor, subtitleBody, subtitles } from './api';

(globalThis as unknown as { __drakBili: unknown }).__drakBili = { resolve, streamsFor, subtitles, subtitleBody };
