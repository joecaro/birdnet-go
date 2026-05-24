import { beforeEach, describe, expect, it, vi } from 'vitest';

const eventSourceMock = vi.hoisted(() => {
  const instances: FakeReconnectingEventSource[] = [];

  class FakeReconnectingEventSource extends EventTarget {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    close = vi.fn();

    constructor(
      public url: string,
      public options?: Record<string, unknown>
    ) {
      super();
      instances.push(this);
    }

    emitOpen(): void {
      this.onopen?.(new Event('open'));
    }

    emitMessage(payload: unknown, eventName = 'message'): void {
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload);

      if (eventName === 'message') {
        this.onmessage?.({ data } as MessageEvent<string>);
        return;
      }

      const event = new MessageEvent(eventName, { data });
      this.dispatchEvent(event);
    }

    emitError(): void {
      this.onerror?.(new Event('error'));
    }
  }

  return { instances, FakeReconnectingEventSource };
});

vi.mock('reconnecting-eventsource', () => ({
  default: eventSourceMock.FakeReconnectingEventSource,
}));

vi.mock('$lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'browserNotifications.detectionTitle') {
      return `New bird: ${String(params?.species ?? '')}`;
    }
    if (key === 'browserNotifications.confidence') {
      return `${String(params?.confidence ?? '')}%`;
    }
    if (key === 'browserNotifications.bodyFallback') {
      return 'New bird detected';
    }
    if (key === 'browserNotifications.testSpecies') {
      return 'Northern Cardinal';
    }
    return key;
  },
}));

vi.mock('$lib/stores/connectionState.svelte', () => ({
  onSSEActivity: vi.fn(),
  onSSEError: vi.fn(),
}));

vi.mock('$lib/utils/urlHelpers', () => ({
  buildAppUrl: (path: string) => path,
}));

vi.mock('$lib/utils/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

type BrowserNotificationModule = typeof import('./browserDetectionNotifications.svelte');

interface MockNotificationRecord {
  title: string;
  options?: NotificationOptions;
}

function installNotificationMock(permission: NotificationPermission = 'default') {
  const records: MockNotificationRecord[] = [];

  class MockNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      MockNotification.permission = 'granted';
      return 'granted' as NotificationPermission;
    });

    onclick: (() => void) | null = null;

    constructor(
      public title: string,
      public options?: NotificationOptions
    ) {
      records.push({ title, options });
    }

    close = vi.fn();
  }

  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: MockNotification,
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    writable: true,
    value: MockNotification,
  });

  return { MockNotification, records };
}

async function loadModule(): Promise<BrowserNotificationModule> {
  vi.resetModules();
  const module = await import('./browserDetectionNotifications.svelte');
  module.browserDetectionNotifications.dispose();
  eventSourceMock.instances.length = 0;
  return module;
}

describe('browserDetectionNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    eventSourceMock.instances.length = 0;
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: null },
    });
  });

  it('requests permission, persists opt-in, and starts the detection stream', async () => {
    const { MockNotification } = installNotificationMock();
    const { browserDetectionNotifications, browserDetectionNotificationState } = await loadModule();

    const permission = await browserDetectionNotifications.setEnabled(true);

    expect(permission).toBe('granted');
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browserDetectionNotificationState.enabled).toBe(true);
    expect(eventSourceMock.instances).toHaveLength(1);
    expect(eventSourceMock.instances[0].url).toBe('/api/v2/detections/stream');

    eventSourceMock.instances[0].emitOpen();
    expect(browserDetectionNotificationState.isRunning).toBe(true);

    expect(
      JSON.parse(localStorage.getItem('birdnet-go:browser-detection-notifications') ?? '{}')
    ).toMatchObject({ enabled: true, cooldownMinutes: 2 });
  });

  it('notifies only while unfocused and deduplicates repeated species during cooldown', async () => {
    const notificationMock = installNotificationMock('granted');
    const { browserDetectionNotifications, browserDetectionNotificationState } = await loadModule();
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    await browserDetectionNotifications.setEnabled(true);
    expect(browserDetectionNotificationState.enabled).toBe(true);
    expect(browserDetectionNotificationState.permission).toBe('granted');
    expect(document.visibilityState).toBe('hidden');
    expect(document.hasFocus()).toBe(false);
    await browserDetectionNotifications.showTestNotification();
    expect(notificationMock.records).toHaveLength(1);
    notificationMock.records.length = 0;
    const stream = eventSourceMock.instances[0];
    expect(stream.onmessage).toBeTypeOf('function');

    stream.emitMessage({
      id: 1,
      eventType: 'detection',
      commonName: 'Northern Cardinal',
      scientificName: 'Cardinalis cardinalis',
      confidence: 0.91,
      time: '08:10',
      source: { displayName: 'Back yard' },
    });
    await vi.waitFor(() => expect(notificationMock.records).toHaveLength(1));

    expect(notificationMock.records[0].title).toBe('New bird: Northern Cardinal');
    expect(notificationMock.records[0].options?.body).toBe('91% · 08:10 · Back yard');
    expect(notificationMock.records[0].options?.data).toEqual({ url: '/ui/detections/1' });

    stream.emitMessage({
      id: 1,
      eventType: 'detection',
      commonName: 'Northern Cardinal',
      scientificName: 'Cardinalis cardinalis',
    });
    stream.emitMessage({
      id: 2,
      eventType: 'detection',
      commonName: 'Northern Cardinal',
      scientificName: 'Cardinalis cardinalis',
    });
    await Promise.resolve();
    expect(notificationMock.records).toHaveLength(1);

    browserDetectionNotifications.updateSettings({ cooldownMinutes: 0 });
    stream.emitMessage({
      id: 3,
      eventType: 'detection',
      commonName: 'Northern Cardinal',
      scientificName: 'Cardinalis cardinalis',
    });
    await vi.waitFor(() => expect(notificationMock.records).toHaveLength(2));
  });

  it('keeps the stream running but suppresses notifications while focused', async () => {
    const notificationMock = installNotificationMock('granted');
    const { browserDetectionNotifications, browserDetectionNotificationState } = await loadModule();

    await browserDetectionNotifications.setEnabled(true);
    const stream = eventSourceMock.instances[0];
    stream.emitOpen();

    document.dispatchEvent(new Event('visibilitychange'));
    expect(eventSourceMock.instances).toHaveLength(1);
    expect(browserDetectionNotificationState.isRunning).toBe(true);

    stream.emitMessage({
      id: 10,
      eventType: 'detection',
      commonName: 'Pileated Woodpecker',
      scientificName: 'Dryocopus pileatus',
    });
    await Promise.resolve();

    expect(notificationMock.records).toHaveLength(0);
    expect(browserDetectionNotificationState.isRunning).toBe(true);
  });
});
