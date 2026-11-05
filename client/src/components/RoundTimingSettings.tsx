import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

interface Settings { roundDurationSeconds: number; roundBreakSeconds: number }

export function RoundTimingSettings({ connected }: { connected: boolean }) {
  const [duration, setDuration] = useState('180');
  const [pause, setPause] = useState('5');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    apiRequest<Settings>('/admin/settings').then((settings) => {
      if (!active) return;
      setDuration(String(settings.roundDurationSeconds));
      setPause(String(settings.roundBreakSeconds));
      setLoaded(true);
      setNotice(null);
    }).catch(() => { if (active) setNotice({ text: 'Chưa tải được cài đặt thời gian.', error: true }); });
    return () => { active = false; };
  }, [reload]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !loaded) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest<Settings>('/admin/settings', {
        method: 'PATCH', body: JSON.stringify({ roundDurationSeconds: Number(duration), roundBreakSeconds: Number(pause) }),
      });
      setDuration(String(result.roundDurationSeconds));
      setPause(String(result.roundBreakSeconds));
      setNotice({ text: 'Đã lưu. Hiệp đang đấu sẽ đếm lại từ thời gian vừa đặt.', error: false });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Không lưu được thời gian.', error: true });
    } finally { setSaving(false); }
  };

  return <section className="card timing-settings">
    <span className="eyebrow">ĐỒNG HỒ TRẬN ĐẤU</span><h2>Cài đặt thời gian</h2>
    <form onSubmit={save}>
      <fieldset disabled={!loaded || saving || !connected}>
        <label className="field-label" htmlFor="round-duration">Thời gian mỗi hiệp (giây)</label>
        <input id="round-duration" type="number" min={10} max={3600} step={1} required value={duration} onChange={(event) => setDuration(event.target.value)} />
        <div className="timing-presets">{[60, 180, 300].map((seconds) => <button key={seconds} type="button" className={`btn btn-secondary ${duration === String(seconds) ? 'is-selected' : ''}`} onClick={() => setDuration(String(seconds))}>{seconds / 60} phút</button>)}</div>
        <label className="field-label" htmlFor="round-break">Nghỉ giữa hai hiệp (giây)</label>
        <input id="round-break" type="number" min={0} max={120} step={1} required value={pause} onChange={(event) => setPause(event.target.value)} />
        <button className="btn btn-primary timing-save" type="submit">{saving ? 'Đang lưu…' : 'Lưu & áp dụng thời gian'}</button>
      </fieldset>
    </form>
    <p className="help-text">Mỗi hiệp 10–3600 giây. Lưu khi đang đấu sẽ đếm lại từ bây giờ; khi đang nghỉ, áp dụng từ hiệp tới. Hết giờ: phe nhiều điểm hơn thắng, bằng điểm thì hòa.</p>
    {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error-text' : 'badge-ok'}>{notice.text}</p>}
    {!loaded && notice?.error && <button className="btn btn-secondary timing-save" onClick={() => setReload((value) => value + 1)}>Tải lại cài đặt</button>}
  </section>;
}
