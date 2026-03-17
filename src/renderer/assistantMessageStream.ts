export function mergeAssistantMessages(currentText: string, nextText: string): string {
  const current = currentText.trim();
  const next = nextText.trim();

  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  if (next.includes(current)) {
    return next;
  }

  if (current.includes(next)) {
    return current;
  }

  const overlapLength = getTextOverlapLength(current, next);
  if (overlapLength > 0) {
    return `${current}${next.slice(overlapLength)}`;
  }

  return next;
}

export function shouldContinueAssistantStream(
  previousUpdateAt: number,
  now: number,
  currentText: string,
): boolean {
  return Boolean(currentText.trim()) && now - previousUpdateAt <= 1200;
}

function getTextOverlapLength(current: string, next: string): number {
  const maxOverlap = Math.min(current.length, next.length);

  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (current.slice(-overlapLength) === next.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}
