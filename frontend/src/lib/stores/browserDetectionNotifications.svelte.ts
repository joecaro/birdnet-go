import ReconnectingEventSource from 'reconnecting-eventsource';
import { t } from '$lib/i18n';
import { onSSEActivity, onSSEError } from '$lib/stores/connectionState.svelte';
import { buildAppUrl } from '$lib/utils/urlHelpers';
import { getLogger } from '$lib/utils/logger';
import { isPlainObject } from '$lib/utils/security';

const logger = getLogger('browserDetectionNotifications');

const DETECTION_STREAM_ENDPOINT = '/api/v2/detections/stream';
const STORAGE_KEY = 'birdnet-go:browser-detection-notifications';
const DEFAULT_COOLDOWN_MINUTES = 2;
const MAX_COOLDOWN_MINUTES = 1440;
const MAX_SEEN_DETECTION_IDS = 500;
const NOTIFICATION_ICON_PATH = '/ui/assets/favicon-32x32.png';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export interface BrowserDetectionNotificationSettings {
  enabled: boolean;
  cooldownMinutes: number;
}

interface BrowserDetectionNotificationState extends BrowserDetectionNotificationSettings {
  permission: BrowserNotificationPermission;
  isRunning: boolean;
  lastError: string;
}

interface DetectionStreamPayload {
  id: number;
  commonName: string;
  scientificName: string;
  confidence?: number;
  date?: string;
  time?: string;
  timestamp?: string;
  source?: {
    displayName?: string;
  } | null;
  eventType?: string;
}

export const browserDetectionNotificationState = $state<BrowserDetectionNotificationState>({
  enabled: false,
  cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
  permission: 'unsupported',
  isRunning: false,
  lastError: '',
});

function supportsBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function currentPermission(): BrowserNotificationPermission {
  if (!supportsBrowserNotifications()) return 'unsupported';
  return globalThis.Notification.permission;
}

function clampCooldown(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_COOLDOWN_MINUTES;
  return Math.max(0, Math.min(MAX_COOLDOWN_MINUTES, Math.round(numeric)));
}

function readSettings(): BrowserDetectionNotificationSettings {
  if (typeof window === 'undefined') {
    return { enabled: false, cooldownMinutes: DEFAULT_COOLDOWN_MINUTES };
  }

  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { enabled: false, cooldownMinutes: DEFAULT_COOLDOWN_MINUTES };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      return { enabled: false, cooldownMinutes: DEFAULT_COOLDOWN_MINUTES };
    }

    return {
      enabled: parsed.enabled === true,
      cooldownMinutes: clampCooldown(parsed.cooldownMinutes),
    };
  } catch {
    return { enabled: false, cooldownMinutes: DEFAULT_COOLDOWN_MINUTES };
  }
}

function writeSettings(settings: BrowserDetectionNotificationSettings): void {
  if (typeof window === 'undefined') return;

  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    logger.warn('Failed to save browser detection notification settings', error, {
      component: 'browserDetectionNotifications',
      action: 'writeSettings',
    });
  }
}

function applySettings(settings: BrowserDetectionNotificationSettings): void {
  browserDetectionNotificationState.enabled = settings.enabled;
  browserDetectionNotificationState.cooldownMinutes = settings.cooldownMinutes;
  browserDetectionNotificationState.permission = currentPermission();
  browserDetectionNotificationState.lastError = '';
}

function parseDetectionPayload(data: unknown): DetectionStreamPayload | null {
  if (!isPlainObject(data)) return null;

  const eventType = typeof data.eventType === 'string' ? data.eventType : undefined;
  if (eventType && eventType !== 'detection') return null;

  if (
    typeof data.id !== 'number' ||
    typeof data.commonName !== 'string' ||
    data.commonName.length === 0 ||
    typeof data.scientificName !== 'string'
  ) {
    return null;
  }

  const source = isPlainObject(data.source)
    ? {
        displayName:
          typeof data.source.displayName === 'string' ? data.source.displayName : undefined,
      }
    : null;

  return {
    id: data.id,
    commonName: data.commonName,
    scientificName: data.scientificName,
    confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    date: typeof data.date === 'string' ? data.date : undefined,
    time: typeof data.time === 'string' ? data.time : undefined,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
    source,
    eventType,
  };
}

function shouldNotifyWhileBackgrounded(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

function formatDetectionTime(detection: DetectionStreamPayload): string {
  if (detection.time) return detection.time;
  if (!detection.timestamp) return '';

  const timestamp = new Date(detection.timestamp);
  if (Number.isNaN(timestamp.getTime())) return '';
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function notificationBody(detection: DetectionStreamPayload): string {
  const parts: string[] = [];
  if (typeof detection.confidence === 'number') {
    parts.push(
      t('browserNotifications.confidence', {
        confidence: Math.round(detection.confidence * 100),
      })
    );
  }

  const time = formatDetectionTime(detection);
  if (time) parts.push(time);
  if (detection.source?.displayName) parts.push(detection.source.displayName);

  return parts.length > 0 ? parts.join(' · ') : t('browserNotifications.bodyFallback');
}

class BrowserDetectionNotificationManager {
  private eventSource: ReconnectingEventSource | null = null;
  private initialized = false;
  private readonly seenDetectionIds: Set<number> = new Set();
  private readonly seenDetectionQueue: number[] = [];
  private readonly lastSpeciesNotificationAt: Map<string, number> = new Map();

  init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    applySettings(readSettings());

    globalThis.window.addEventListener('focus', this.refreshPermission);
    globalThis.document.addEventListener('visibilitychange', this.refreshPermission);
    globalThis.window.addEventListener('beforeunload', this.dispose);

    this.syncConnection();
  }

  dispose = (): void => {
    this.disconnect();
    if (typeof window !== 'undefined') {
      globalThis.window.removeEventListener('focus', this.refreshPermission);
      globalThis.document.removeEventListener('visibilitychange', this.refreshPermission);
      globalThis.window.removeEventListener('beforeunload', this.dispose);
    }
    this.initialized = false;
  };

  refreshPermission = (): void => {
    browserDetectionNotificationState.permission = currentPermission();
    this.syncConnection();
  };

  start(): void {
    this.init();
    this.syncConnection();
  }

  updateSettings(updates: Partial<BrowserDetectionNotificationSettings>): void {
    const nextSettings: BrowserDetectionNotificationSettings = {
      enabled: updates.enabled ?? browserDetectionNotificationState.enabled,
      cooldownMinutes: clampCooldown(
        updates.cooldownMinutes ?? browserDetectionNotificationState.cooldownMinutes
      ),
    };

    applySettings(nextSettings);
    writeSettings(nextSettings);
    this.syncConnection();
  }

  async setEnabled(enabled: boolean): Promise<BrowserNotificationPermission> {
    if (!enabled) {
      this.updateSettings({ enabled: false });
      return browserDetectionNotificationState.permission;
    }

    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      this.updateSettings({ enabled: false });
      return permission;
    }

    this.updateSettings({ enabled: true });
    return permission;
  }

  async requestPermission(): Promise<BrowserNotificationPermission> {
    if (!supportsBrowserNotifications()) {
      browserDetectionNotificationState.permission = 'unsupported';
      browserDetectionNotificationState.enabled = false;
      writeSettings({
        enabled: false,
        cooldownMinutes: browserDetectionNotificationState.cooldownMinutes,
      });
      return 'unsupported';
    }

    try {
      const permission =
        globalThis.Notification.permission === 'default'
          ? await globalThis.Notification.requestPermission()
          : globalThis.Notification.permission;
      browserDetectionNotificationState.permission = permission;
      return permission;
    } catch (error) {
      logger.warn('Failed to request browser notification permission', error, {
        component: 'browserDetectionNotifications',
        action: 'requestPermission',
      });
      browserDetectionNotificationState.lastError = t(
        'settings.notifications.browser.errors.requestFailed'
      );
      browserDetectionNotificationState.permission = currentPermission();
      return browserDetectionNotificationState.permission;
    }
  }

  async showTestNotification(): Promise<boolean> {
    const permission = await this.requestPermission();
    if (permission !== 'granted') return false;

    await this.showNotification({
      id: Date.now(),
      commonName: t('browserNotifications.testSpecies'),
      scientificName: 'BirdNET-Go',
      confidence: 0.92,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    return true;
  }

  private syncConnection(): void {
    if (
      browserDetectionNotificationState.enabled &&
      browserDetectionNotificationState.permission === 'granted'
    ) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  private connect(): void {
    if (this.eventSource || typeof window === 'undefined') return;

    try {
      this.eventSource = new ReconnectingEventSource(buildAppUrl(DETECTION_STREAM_ENDPOINT), {
        max_retry_time: 30000,
        withCredentials: false,
      });

      this.eventSource.onopen = () => {
        browserDetectionNotificationState.isRunning = true;
        browserDetectionNotificationState.lastError = '';
        onSSEActivity();
      };

      this.eventSource.onmessage = event => {
        this.handleStreamMessage(event.data);
      };

      this.eventSource.addEventListener('detection', (event: Event) => {
        const messageEvent = event as MessageEvent;
        this.handleStreamMessage(messageEvent.data);
      });

      this.eventSource.addEventListener('heartbeat', () => {
        onSSEActivity();
      });

      this.eventSource.addEventListener('connected', () => {
        browserDetectionNotificationState.isRunning = true;
        browserDetectionNotificationState.lastError = '';
        onSSEActivity();
      });

      this.eventSource.onerror = () => {
        browserDetectionNotificationState.isRunning = false;
        browserDetectionNotificationState.lastError = t(
          'settings.notifications.browser.errors.stream'
        );
        onSSEError();
      };
    } catch (error) {
      browserDetectionNotificationState.isRunning = false;
      browserDetectionNotificationState.lastError = t(
        'settings.notifications.browser.errors.stream'
      );
      logger.warn('Failed to start browser detection notification stream', error, {
        component: 'browserDetectionNotifications',
        action: 'connect',
      });
    }
  }

  private disconnect(): void {
    if (!this.eventSource) return;
    this.eventSource.close();
    this.eventSource = null;
    browserDetectionNotificationState.isRunning = false;
  }

  private handleStreamMessage(raw: string): void {
    try {
      const parsed: unknown = JSON.parse(raw);
      onSSEActivity();
      const detection = parseDetectionPayload(parsed);
      if (!detection) return;
      void this.handleDetection(detection);
    } catch (error) {
      logger.debug('Ignoring malformed detection stream message for browser notification', error, {
        component: 'browserDetectionNotifications',
        action: 'handleStreamMessage',
      });
    }
  }

  private async handleDetection(detection: DetectionStreamPayload): Promise<void> {
    if (this.seenDetectionIds.has(detection.id)) return;
    this.rememberDetectionId(detection.id);

    if (
      !browserDetectionNotificationState.enabled ||
      browserDetectionNotificationState.permission !== 'granted' ||
      !shouldNotifyWhileBackgrounded()
    ) {
      return;
    }

    const speciesKey = detection.scientificName || detection.commonName;
    const now = Date.now();
    const cooldownMs = browserDetectionNotificationState.cooldownMinutes * 60_000;
    const lastNotifiedAt = this.lastSpeciesNotificationAt.get(speciesKey);
    if (cooldownMs > 0 && lastNotifiedAt !== undefined && now - lastNotifiedAt < cooldownMs) {
      return;
    }

    this.lastSpeciesNotificationAt.set(speciesKey, now);
    await this.showNotification(detection);
  }

  private rememberDetectionId(id: number): void {
    this.seenDetectionIds.add(id);
    this.seenDetectionQueue.push(id);

    while (this.seenDetectionQueue.length > MAX_SEEN_DETECTION_IDS) {
      const oldest = this.seenDetectionQueue.shift();
      if (oldest !== undefined) this.seenDetectionIds.delete(oldest);
    }
  }

  private async showNotification(detection: DetectionStreamPayload): Promise<void> {
    if (!supportsBrowserNotifications() || globalThis.Notification.permission !== 'granted') {
      return;
    }

    const title = t('browserNotifications.detectionTitle', { species: detection.commonName });
    const url = buildAppUrl(`/ui/detections/${detection.id}`);
    const options: NotificationOptions = {
      body: notificationBody(detection),
      icon: buildAppUrl(NOTIFICATION_ICON_PATH),
      badge: buildAppUrl(NOTIFICATION_ICON_PATH),
      tag: `birdnet-go-detection-${detection.id}`,
      data: { url },
    };

    try {
      if (navigator.serviceWorker?.controller) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
        return;
      }

      const notification = new globalThis.Notification(title, options);
      notification.onclick = () => {
        globalThis.window.focus();
        globalThis.window.location.href = url;
        notification.close();
      };
    } catch (error) {
      logger.debug('Failed to show browser detection notification', error, {
        component: 'browserDetectionNotifications',
        action: 'showNotification',
      });
    }
  }
}

export const browserDetectionNotifications = new BrowserDetectionNotificationManager();
