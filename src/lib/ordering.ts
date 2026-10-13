/**
 * Places `movedId` into a column's full ordering, given where it was dropped
 * among the tasks that are currently visible (a filter may hide some).
 *
 * The moved task lands right after its visible predecessor, or right before its
 * visible successor when it was dropped first. Hidden tasks keep their order.
 */
export function placeInColumn(fullIds: number[], visibleOrder: number[], movedId: number): number[] {
  const rest = fullIds.filter((id) => id !== movedId);
  const at = visibleOrder.indexOf(movedId);
  if (at === -1) return [...rest, movedId];

  const prev = visibleOrder.slice(0, at).reverse().find((id) => rest.includes(id));
  if (prev !== undefined) {
    const i = rest.indexOf(prev);
    return [...rest.slice(0, i + 1), movedId, ...rest.slice(i + 1)];
  }
  const next = visibleOrder.slice(at + 1).find((id) => rest.includes(id));
  if (next !== undefined) {
    const i = rest.indexOf(next);
    return [...rest.slice(0, i), movedId, ...rest.slice(i)];
  }
  return [movedId, ...rest];
}
