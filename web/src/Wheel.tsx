import { useEffect, useRef, useState } from 'react';

/** 扇区只依赖 名称 + 占比，后端与本地抽签都能满足 */
export interface WheelSegment {
  placeId: string;
  name: string;
  share: number;
}

const PALETTE = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#51cf66',
  '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac',
  '#ff922b', '#94d82d',
];

const TAU = Math.PI * 2;

interface Props {
  segments: WheelSegment[];
  /** 本次抽中的扇区下标；null 表示还没抽 */
  winnerIndex: number | null;
  spinning: boolean;
  onSpinEnd: () => void;
}

export function Wheel({ segments, winnerIndex, spinning, onSpinEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState(0);
  const [transition, setTransition] = useState('none');
  const prevWinner = useRef<number | null>(null);

  // 计算每个扇区的起止角（从顶部 -90° 起，顺时针累加 share）
  const angles = (() => {
    const out: { start: number; end: number }[] = [];
    let acc = 0;
    for (const s of segments) {
      out.push({ start: acc, end: acc + s.share });
      acc += s.share;
    }
    return out;
  })();

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 460;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 12;

    // 外圈光晕
    const glow = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R + 12);
    glow.addColorStop(0, 'rgba(120,140,255,0.22)');
    glow.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, TAU);
    ctx.fill();

    if (segments.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '500 18px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('先选城市和项目，然后转盘', cx, cy + 6);
      return;
    }

    angles.forEach((a, i) => {
      const s = -Math.PI / 2 + a.start * TAU;
      const e = -Math.PI / 2 + a.end * TAU;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, s, e);
      ctx.closePath();
      const isWinner = winnerIndex === i;
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.globalAlpha = winnerIndex === null ? 0.92 : isWinner ? 1 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(15,18,38,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 文字沿半径方向排布
      const mid = (a.start + a.end) / 2;
      const textAngle = -Math.PI / 2 + mid * TAU;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(textAngle);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const fontSize = segments.length > 9 ? 12 : 14;
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = '#131728';
      const label = segments[i].name.length > 11 ? `${segments[i].name.slice(0, 10)}…` : segments[i].name;
      ctx.fillText(label, R - 16, 0);
      ctx.restore();
    });

    // 中心圆
    ctx.beginPath();
    ctx.arc(cx, cy, 62, 0, TAU);
    const cg = ctx.createLinearGradient(cx - 40, cy - 40, cx + 40, cy + 40);
    cg.addColorStop(0, '#252b4d');
    cg.addColorStop(1, '#141834');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [segments, winnerIndex, angles.length]);

  // 抽签动画：把中奖扇区的中心转到顶部指针处
  useEffect(() => {
    if (!spinning || winnerIndex == null || segments.length === 0) return;
    const mid = (angles[winnerIndex].start + angles[winnerIndex].end) / 2;
    const jitter = (Math.random() - 0.5) * Math.min(0.7, segments[winnerIndex].share * 0.6);
    const target = 360 * 6 - (mid + jitter) * 360;
    const from = rotation % 360;
    const delta = ((target - from) % 360 + 360) % 360 + 360 * 6;
    setTransition('none');
    requestAnimationFrame(() => {
      setTransition('transform 5.2s cubic-bezier(0.12, 0.72, 0.02, 1)');
      setRotation((r) => r + delta);
    });
    const t = setTimeout(onSpinEnd, 5350);
    prevWinner.current = winnerIndex;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, winnerIndex]);

  // 换了一批扇区（新的一轮但还没转），复位角度
  useEffect(() => {
    if (winnerIndex === null) {
      setTransition('none');
      setRotation(0);
    }
  }, [winnerIndex]);

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" aria-hidden />
      <canvas
        ref={canvasRef}
        className="wheel-canvas"
        style={{ transform: `rotate(${rotation}deg)`, transition }}
      />
    </div>
  );
}
