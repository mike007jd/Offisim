import { truncate } from '../../../lib/format-time';
import { drawRoundedRect } from '../canvas-primitives';
import type {
  FrameContext,
  ManagerMarkerData,
  MeetingBubbleData,
  SceneCanvasPalette,
  SceneSnapshot,
} from '../office-2d-canvas-renderer';

export function drawCeremony(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  if (snapshot.managerMarker) drawManagerMarker(ctx, snapshot.managerMarker, frame.palette);
  if (snapshot.meetingBubble) drawMeetingBubble(ctx, snapshot.meetingBubble, frame.palette);
}

function drawManagerMarker(
  ctx: CanvasRenderingContext2D,
  marker: ManagerMarkerData,
  palette: SceneCanvasPalette,
): void {
  const size = 12;
  ctx.save();
  ctx.fillStyle = palette.managerMarkerFill;
  ctx.strokeStyle = palette.managerMarkerStroke;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(marker.x, marker.y - size);
  ctx.lineTo(marker.x + size, marker.y);
  ctx.lineTo(marker.x, marker.y + size);
  ctx.lineTo(marker.x - size, marker.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.managerMarkerLabel;
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Manager', marker.x, marker.y + size + 8);
  ctx.restore();
}

function drawMeetingBubble(
  ctx: CanvasRenderingContext2D,
  bubble: MeetingBubbleData,
  palette: SceneCanvasPalette,
): void {
  ctx.save();
  const bx = bubble.x;
  const by = bubble.y;
  const bubbleW = 280;
  const hasWaiting = bubble.waitingLabels.length > 0;
  const bubbleH = hasWaiting ? 54 + bubble.waitingLabels.length * 12 : 32;
  const extraH = bubble.extraWaitingCount > 0 ? 12 : 0;
  const totalH = bubbleH + extraH;

  drawRoundedRect(ctx, bx - bubbleW / 2, by - 16, bubbleW, totalH, {
    fill: palette.meetingBubbleBg,
    stroke: palette.meetingBubbleStroke,
    lineWidth: 1,
    radius: 16,
  });

  const prevAlpha = ctx.globalAlpha;
  ctx.fillStyle = bubble.phaseColor;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(bx - bubbleW / 2 + 20, by, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = prevAlpha;

  ctx.fillStyle = palette.meetingBubbleTitle;
  ctx.font = '600 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(bubble.bubbleText, 35), bx - bubbleW / 2 + 32, by);

  if (bubble.participantCount > 0) {
    ctx.fillStyle = palette.meetingBubbleParticipantText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${bubble.participantCount}p`, bx + bubbleW / 2 - 15, by);
  }

  for (let i = 0; i < bubble.waitingLabels.length; i++) {
    ctx.fillStyle = palette.meetingBubbleWaitingText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(bubble.waitingLabels[i] ?? '', bx - bubbleW / 2 + 32, by + 14 + i * 11);
  }

  if (bubble.extraWaitingCount > 0) {
    ctx.fillStyle = palette.meetingBubbleExtraText;
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
