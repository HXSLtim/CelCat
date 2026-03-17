export type AudioInputDeviceOption = {
  id: string;
  label: string;
};

export function formatAudioInputDevices(
  devices: ArrayLike<{
    deviceId: string;
    kind: string;
    label: string;
  }>,
): AudioInputDeviceOption[] {
  const options: AudioInputDeviceOption[] = [];

  for (let index = 0; index < devices.length; index += 1) {
    const device = devices[index];

    if (device.kind !== 'audioinput') {
      continue;
    }

    options.push({
      id: device.deviceId,
      label: device.label || `麦克风 ${options.length + 1}`,
    });
  }

  return options;
}

export function getPreferredAudioInputDeviceId(
  devices: AudioInputDeviceOption[],
  preferredId: string,
): string {
  if (devices.some((device) => device.id === preferredId)) {
    return preferredId;
  }

  return devices[0]?.id ?? '';
}
