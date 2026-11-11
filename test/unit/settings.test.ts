import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  msToNextScheduleEdge,
  normalizeSettings,
  parseClock,
  scheduleActive,
  themeSignature,
} from '../../src/shared/settings';

const at = (h: number, m = 0, s = 0) => new Date(2026, 0, 15, h, m, s);
const sched = (start: string, end: string) => ({ ...DEFAULT_SETTINGS, scheduleEnabled: true, scheduleStart: start, scheduleEnd: end });

describe('normalizeSettings', () => {
  it('fills new fields for settings saved by an older version', () => {
    const s = normalizeSettings({ enabled: false, brightness: 70, siteModes: { 'a.com': 'off' } });
    expect(s.enabled).toBe(false);
    expect(s.brightness).toBe(70);
    expect(s.theme).toBe('default');
    expect(s.saturation).toBe(50);
    expect(s.imageBrightness).toBe(100);
    expect(s.scheduleEnabled).toBe(false);
  });
  it('rejects invalid values', () => {
    const s = normalizeSettings({ theme: 'neon', saturation: 999, imageBrightness: 1, scheduleStart: '25:00', scheduleEnd: 7 });
    expect(s.theme).toBe('default');
    expect(s.saturation).toBe(100);
    expect(s.imageBrightness).toBe(30);
    expect(s.scheduleStart).toBe('20:00');
    expect(s.scheduleEnd).toBe('07:00');
  });
});

describe('schedule', () => {
  it('parses clock strings', () => {
    expect(parseClock('07:05')).toBe(425);
    expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('7pm')).toBeNull();
  });
  it('is always active when the schedule is off', () => {
    expect(scheduleActive(DEFAULT_SETTINGS, at(12))).toBe(true);
    expect(msToNextScheduleEdge(DEFAULT_SETTINGS, at(12))).toBeNull();
  });
  it('handles a range that crosses midnight', () => {
    const s = sched('20:00', '07:00');
    expect(scheduleActive(s, at(19, 59))).toBe(false);
    expect(scheduleActive(s, at(20))).toBe(true);
    expect(scheduleActive(s, at(2))).toBe(true);
    expect(scheduleActive(s, at(7))).toBe(false);
  });
  it('handles a same-day range', () => {
    const s = sched('09:00', '18:00');
    expect(scheduleActive(s, at(8, 59))).toBe(false);
    expect(scheduleActive(s, at(9))).toBe(true);
    expect(scheduleActive(s, at(18))).toBe(false);
  });
  it('treats identical start and end as all day', () => {
    expect(scheduleActive(sched('08:00', '08:00'), at(3))).toBe(true);
  });
  it('computes the time to the next switch', () => {
    const s = sched('20:00', '07:00');
    expect(msToNextScheduleEdge(s, at(19, 30))).toBe(30 * 60_000);
    expect(msToNextScheduleEdge(s, at(23, 0, 30))).toBe(8 * 3600_000 - 30_000);
    // 正好在切换点上：下一次是另一端
    expect(msToNextScheduleEdge(s, at(20))).toBe(11 * 3600_000);
  });
});

describe('themeSignature', () => {
  it('changes only when the generated colors would change', () => {
    const a = themeSignature(DEFAULT_SETTINGS);
    expect(themeSignature({ ...DEFAULT_SETTINGS, dimImages: false, siteModes: { 'a.com': 'off' } })).toBe(a);
    expect(themeSignature({ ...DEFAULT_SETTINGS, theme: 'warm' })).not.toBe(a);
    expect(themeSignature({ ...DEFAULT_SETTINGS, brightness: 60 })).not.toBe(a);
  });
});
