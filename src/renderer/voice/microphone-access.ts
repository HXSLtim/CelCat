export async function ensureMicrophoneAccess(
  globalLike: Record<string, any>,
): Promise<{ granted: boolean; error: string }> {
  const mediaDevices = globalLike.navigator?.mediaDevices;

  if (!mediaDevices?.getUserMedia) {
    return {
      granted: true,
      error: '',
    };
  }

  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }

    return {
      granted: true,
      error: '',
    };
  } catch (error: any) {
    return {
      granted: false,
      error: mapMicrophoneAccessError(error),
    };
  }
}

function mapMicrophoneAccessError(error: { name?: string } | undefined): string {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '麦克风权限被拒绝，请在系统隐私设置中允许访问';
    case 'NotFoundError':
      return '没有检测到可用麦克风';
    case 'NotReadableError':
      return '麦克风正在被其他应用占用';
    default:
      return '暂时无法访问麦克风';
  }
}
