import zlib from 'node:zlib';

const PROTOCOL_VERSION = 0b0001;
const DEFAULT_HEADER_SIZE = 0b0001;

const CLIENT_FULL_REQUEST = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;

const SERVER_FULL_RESPONSE = 0b1001;
const SERVER_ACK = 0b1011;
const SERVER_ERROR_RESPONSE = 0b1111;

const MSG_WITH_EVENT = 0b0100;
const JSON_SERIALIZATION = 0b0001;
const NO_SERIALIZATION = 0b0000;
const GZIP_COMPRESSION = 0b0001;

export const CLIENT_EVENT = {
  startConnection: 1,
  finishConnection: 2,
  startSession: 100,
  finishSession: 102,
  sayHello: 300,
  taskRequest: 200,
  chatTextQuery: 501,
} as const;

export type ParsedRealtimeResponse =
  | {
      messageType: 'SERVER_FULL_RESPONSE' | 'SERVER_ACK';
      event?: number;
      sessionId?: string;
      payload: unknown;
      rawPayload: Buffer;
    }
  | {
      messageType: 'SERVER_ERROR';
      code: number;
      payload: unknown;
      rawPayload: Buffer;
    }
  | {
      messageType: 'UNKNOWN';
      payload: null;
      rawPayload: Buffer;
    };

function generateHeader(
  messageType = CLIENT_FULL_REQUEST,
  messageTypeSpecificFlags = MSG_WITH_EVENT,
  serializationMethod = JSON_SERIALIZATION,
  compressionType = GZIP_COMPRESSION,
): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE;
  header[1] = (messageType << 4) | messageTypeSpecificFlags;
  header[2] = (serializationMethod << 4) | compressionType;
  header[3] = 0;
  return header;
}

function gzipPayload(payload: Buffer): Buffer {
  return zlib.gzipSync(payload);
}

function buildSessionPayloadFrame(event: number, sessionId: string, payload: Buffer): Buffer {
  const sessionIdBuffer = Buffer.from(sessionId, 'utf8');
  const gzippedPayload = gzipPayload(payload);

  return Buffer.concat([
    generateHeader(),
    toUInt32Buffer(event),
    toUInt32Buffer(sessionIdBuffer.length),
    sessionIdBuffer,
    toUInt32Buffer(gzippedPayload.length),
    gzippedPayload,
  ]);
}

function toUInt32Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

export function buildStartConnectionFrame(): Buffer {
  const payload = gzipPayload(Buffer.from('{}', 'utf8'));
  return Buffer.concat([
    generateHeader(),
    toUInt32Buffer(CLIENT_EVENT.startConnection),
    toUInt32Buffer(payload.length),
    payload,
  ]);
}

export function buildFinishConnectionFrame(): Buffer {
  const payload = gzipPayload(Buffer.from('{}', 'utf8'));
  return Buffer.concat([
    generateHeader(),
    toUInt32Buffer(CLIENT_EVENT.finishConnection),
    toUInt32Buffer(payload.length),
    payload,
  ]);
}

export function buildStartSessionFrame(sessionId: string, payload: Record<string, unknown>): Buffer {
  return buildSessionPayloadFrame(
    CLIENT_EVENT.startSession,
    sessionId,
    Buffer.from(JSON.stringify(payload), 'utf8'),
  );
}

export function buildFinishSessionFrame(sessionId: string): Buffer {
  return buildSessionPayloadFrame(
    CLIENT_EVENT.finishSession,
    sessionId,
    Buffer.from('{}', 'utf8'),
  );
}

export function buildChatTextQueryFrame(sessionId: string, content: string): Buffer {
  return buildSessionPayloadFrame(
    CLIENT_EVENT.chatTextQuery,
    sessionId,
    Buffer.from(JSON.stringify({ content }), 'utf8'),
  );
}

export function buildSayHelloFrame(sessionId: string, content: string): Buffer {
  return buildSessionPayloadFrame(
    CLIENT_EVENT.sayHello,
    sessionId,
    Buffer.from(JSON.stringify({ content }), 'utf8'),
  );
}

export function buildTaskRequestFrame(sessionId: string, audio: Buffer): Buffer {
  const sessionIdBuffer = Buffer.from(sessionId, 'utf8');
  const gzippedPayload = gzipPayload(audio);

  return Buffer.concat([
    generateHeader(CLIENT_AUDIO_ONLY_REQUEST, MSG_WITH_EVENT, NO_SERIALIZATION),
    toUInt32Buffer(CLIENT_EVENT.taskRequest),
    toUInt32Buffer(sessionIdBuffer.length),
    sessionIdBuffer,
    toUInt32Buffer(gzippedPayload.length),
    gzippedPayload,
  ]);
}

export function parseRealtimeResponse(raw: Buffer): ParsedRealtimeResponse {
  if (!raw.length) {
    return {
      messageType: 'UNKNOWN',
      payload: null,
      rawPayload: raw,
    };
  }

  const headerSize = raw[0] & 0x0f;
  const messageType = raw[1] >> 4;
  const flags = raw[1] & 0x0f;
  const serializationMethod = raw[2] >> 4;
  const compressionType = raw[2] & 0x0f;

  let payload = raw.subarray(headerSize * 4);
  let offset = 0;

  if (messageType === SERVER_FULL_RESPONSE || messageType === SERVER_ACK) {
    if (flags & 0b0010) {
      offset += 4;
    }

    let event: number | undefined;
    if (flags & MSG_WITH_EVENT) {
      event = payload.readUInt32BE(offset);
      offset += 4;
    }

    const sessionIdSize = payload.readUInt32BE(offset);
    offset += 4;
    const sessionId = payload.subarray(offset, offset + sessionIdSize).toString('utf8');
    offset += sessionIdSize;

    const payloadSize = payload.readUInt32BE(offset);
    offset += 4;
    const payloadBytes = payload.subarray(offset, offset + payloadSize);
    const inflatedPayload = maybeInflatePayload(payloadBytes, compressionType);

    return {
      messageType: messageType === SERVER_ACK ? 'SERVER_ACK' : 'SERVER_FULL_RESPONSE',
      event,
      sessionId,
      payload: deserializePayload(inflatedPayload, serializationMethod),
      rawPayload: inflatedPayload,
    };
  }

  if (messageType === SERVER_ERROR_RESPONSE) {
    const code = payload.readUInt32BE(0);
    const payloadSize = payload.readUInt32BE(4);
    const payloadBytes = payload.subarray(8, 8 + payloadSize);
    const inflatedPayload = maybeInflatePayload(payloadBytes, compressionType);

    return {
      messageType: 'SERVER_ERROR',
      code,
      payload: deserializePayload(inflatedPayload, serializationMethod),
      rawPayload: inflatedPayload,
    };
  }

  return {
    messageType: 'UNKNOWN',
    payload: null,
    rawPayload: payload,
  };
}

function maybeInflatePayload(payload: Buffer, compressionType: number): Buffer {
  if (compressionType === GZIP_COMPRESSION) {
    return zlib.gunzipSync(payload);
  }

  return payload;
}

function deserializePayload(payload: Buffer, serializationMethod: number): unknown {
  if (serializationMethod === JSON_SERIALIZATION) {
    try {
      return JSON.parse(payload.toString('utf8'));
    } catch {
      return payload.toString('utf8');
    }
  }

  if (serializationMethod === NO_SERIALIZATION) {
    return payload;
  }

  return payload.toString('utf8');
}
