export interface MotionSample {
  timestamp: number;
  x: number;
  y: number;
}

// Render between server samples. Never predict beyond the last known position.
export class MotionTimeline {
  private samples: MotionSample[] = [];

  push(sample: MotionSample) {
    const latest = this.samples[this.samples.length - 1];
    if (latest && sample.timestamp < latest.timestamp) return;
    if (latest?.timestamp === sample.timestamp) this.samples.pop();
    this.samples.push(sample);
    if (this.samples.length > 32) this.samples.shift();
  }

  at(timestamp: number): { x: number; y: number } | null {
    if (!this.samples.length) return null;
    while (this.samples.length > 2 && this.samples[1].timestamp <= timestamp) this.samples.shift();
    const a = this.samples[0];
    const b = this.samples[1];
    if (!b || timestamp <= a.timestamp) return { x: a.x, y: a.y };
    const ratio = Math.min(1, (timestamp - a.timestamp) / Math.max(1, b.timestamp - a.timestamp));
    return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
  }
}
