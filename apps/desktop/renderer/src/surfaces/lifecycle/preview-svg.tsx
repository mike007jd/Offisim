/** 24px blueprint grid `<pattern>` shared by the lifecycle floor previews
 *  (portal office preview, create-your-own blueprint) so the grid texture
 *  cannot drift between them. Render inside `<defs>` and fill a plate rect
 *  with `url(#id)`. */
export function FloorGridPattern({ id }: { id: string }) {
  return (
    <pattern id={id} width={24} height={24} patternUnits="userSpaceOnUse">
      <path
        d="M 24 0 L 0 0 0 24"
        fill="none"
        stroke="var(--off-line)"
        strokeOpacity={0.5}
        strokeWidth={1}
      />
    </pattern>
  );
}
