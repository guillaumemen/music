export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function formatBpm(bpm) {
  if (!Number.isFinite(bpm)) return '—';
  return Number.isInteger(Math.round(bpm * 100) / 100) ? String(Math.round(bpm)) : bpm.toFixed(2).replace(/0$/, '');
}
