const TRUSTED_RENDERER_PATH_SUFFIX = '/renderer/index.html';

function isTrustedRendererRequestUrl(requestingUrl?: string): boolean {
  if (!requestingUrl) {
    return false;
  }

  try {
    const url = new URL(requestingUrl);
    return url.protocol === 'file:' && url.pathname.endsWith(TRUSTED_RENDERER_PATH_SUFFIX);
  } catch {
    return false;
  }
}

export function shouldGrantPermissionRequest(
  permission: string,
  details: {
    mediaTypes?: Array<'audio' | 'video'>;
    requestingUrl?: string;
    isMainFrame?: boolean;
  },
): boolean {
  return permission === 'media'
    && Boolean(details.mediaTypes?.includes('audio'))
    && details.isMainFrame !== false
    && isTrustedRendererRequestUrl(details.requestingUrl);
}

export function shouldGrantPermissionCheck(
  permission: string,
  details: {
    mediaType?: 'audio' | 'video' | 'unknown';
    requestingUrl?: string;
  },
): boolean {
  return permission === 'media'
    && details.mediaType === 'audio'
    && isTrustedRendererRequestUrl(details.requestingUrl);
}
