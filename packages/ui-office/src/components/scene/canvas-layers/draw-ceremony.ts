import { truncate } from '../../../lib/format-time';
import type {
  ManagerMarkerData,
  MeetingBubbleData,
  SceneSnapshot,
  ViewportTransform,
} from '../office-2d-canvas-renderer';

export function drawCeremony(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  _transform: ViewportTransform,
): void {
  if (snapshot.managerMarker) drawManagerMarker(ctx, snapshot.managerMarker);
  if (snapshot.meetingBubble) drawMeetingBubble(ctx, snapshot.meetingBubble);
}

function drawManagerMarker(ctx: CanvasRenderingContext2D, marker: ManagerMarkerData): void {
  const size = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(marker.x, marker.y - size);
  ctx.lineTo(marker.x + size, marker.y);
  ctx.lineTo(marker.x, marker.y + size);
  ctx.lineTo(marker.x - size, marker.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Manager', marker.x, marker.y + size + 8);
  ctx.restore();
}

function drawMeetingBubble(ctx: CanvasRenderingContext2D, bubble: MeetingBubbleData): void {
  ctx.save();
  const bx = bubble.x;
  const by = bubble.y;
  const bubbleW = 280;
  const hasWaiting = bubble.waitingLabels.length > 0;
  const bubbleH = hasWaiting ? 54 + bubble.waitingLabels.length * 12 : 32;
  const extraH = bubble.extraWaitingCount > 0 ? 12 : 0;
  const totalH = bubbleH + extraH;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - bubbleW / 2, by - 16, bubbleW, totalH, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = bubble.phaseColor;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(bx - bubbleW / 2 + 20, by, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '600 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(bubble.bubbleText, 35), bx - bubbleW / 2 + 32, by);

  if (bubble.participantCount > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${bubble.participantCount}p`, bx + bubbleW / 2 - 15, by);
  }

  for (let i = 0; i < bubble.waitingLabels.length; i++) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(bubble.waitingLabels[i] ?? '', bx - bubbleW / 2 + 32, by + 14 + i * 11);
  }

  if (bubble.extraWaitingCount > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `+${bubble.extraWaitingCount} more`,
      bx - bubbleW / 2 + 32,
      by + 14 + bubble.waitingLabels.length * 11,
    );
  }
  ctx.restore();
}
