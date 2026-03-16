export function shouldGrantPermissionRequest(
  permission: string,
  details: {
    mediaTypes?: Array<'audio' | 'video'>;
  },
): boolean {
  return permission === 'media' && Boolean(details.mediaTypes?.includes('audio'));
}

export function shouldGrantPermissionCheck(
  permission: string,
  details: {
    mediaType?: 'audio' | 'video' | 'unknown';
  },
): boolean {
  return permission === 'media' && details.mediaType === 'audio';
}
