import "./index.css";

interface AudioWaveProps {
  size?: number;
  color?: string;
  active?: boolean;
}

/**
 * 录音波形动画组件
 * 使用 CSS 动画实现流畅的波形效果
 */
export function AudioWave({
  size = 20,
  color = "#2563EB",
  active = true,
}: AudioWaveProps) {
  const barWidth = Math.max(2, size / 9);
  const gap = Math.max(1, barWidth * 0.5);
  const minHeight = size * 0.2;
  const maxHeight = size * 0.85;

  return (
    <div
      className={`audio-wave ${active ? "audio-wave--active" : ""}`}
      style={{
        height: size,
        width: size,
        "--bar-width": `${barWidth}px`,
        "--bar-gap": `${gap}px`,
        "--min-height": `${minHeight}px`,
        "--max-height": `${maxHeight}px`,
        "--bar-color": color,
      } as React.CSSProperties}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="audio-wave__bar"
          style={{
            animationDelay: `${(i - 1) * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}

export default AudioWave;
