<!--
CurrentlyHearingCard.svelte - Real-time pending detection display

Purpose:
- Shows species currently being detected by BirdNET in real-time
- Provides visual feedback when detections are approved or rejected
- Retains terminal (approved/rejected) states for a few seconds before fading out
- Shows compact listening, reconnecting, paused, and historical states when no birds are active

Props:
- detections: PendingDetection[] - Current pending detection snapshot from SSE
- className?: string - Additional CSS classes (default: '')
-->
<script lang="ts">
  import { Check, PauseCircle, Radio, WifiOff, X } from '@lucide/svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n';
  import type { PendingDetection } from '$lib/types/pending.types';
  import { buildAppUrl } from '$lib/utils/urlHelpers';

  type StreamState = 'connecting' | 'connected' | 'reconnecting';

  interface Props {
    detections: PendingDetection[];
    className?: string;
    isOnline?: boolean;
    isViewingToday?: boolean;
    updatesPaused?: boolean;
    streamState?: StreamState;
  }

  let {
    detections = [],
    className = '',
    isOnline = true,
    isViewingToday = true,
    updatesPaused = false,
    streamState = 'connecting',
  }: Props = $props();

  // How long terminal (approved/rejected) detections remain visible (ms)
  const TERMINAL_RETENTION_MS = 5000;

  // Retained terminal detections kept visible after backend stops sending them
  let retainedKeys = $state<string[]>([]);
  let retainedData: Record<string, PendingDetection> = {};
  let removalTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  function detectionKey(d: PendingDetection): string {
    return d.source + d.scientificName;
  }

  // Track terminal detections and schedule their removal.
  // Use untrack() when reading retainedKeys to avoid a read-write loop
  // (this effect should only re-run when detections changes, not retainedKeys).
  $effect(() => {
    for (const d of detections) {
      const key = detectionKey(d);
      if ((d.status === 'approved' || d.status === 'rejected') && !(key in removalTimers)) {
        /* eslint-disable security/detect-object-injection -- key is derived from detectionKey(), a controlled string */
        retainedData[key] = d;
        removalTimers[key] = setTimeout(() => {
          delete retainedData[key];
          delete removalTimers[key];
          /* eslint-enable security/detect-object-injection */
          retainedKeys = retainedKeys.filter(k => k !== key);
        }, TERMINAL_RETENTION_MS);
        if (!untrack(() => retainedKeys).includes(key)) {
          retainedKeys = [...untrack(() => retainedKeys), key];
        }
      }
    }
  });

  // Merge incoming detections with retained terminal ones
  let displayDetections = $derived.by(() => {
    // Read retainedKeys to establish reactive dependency
    const retained = retainedKeys;

    const incomingByKey = new Set<string>();
    for (const d of detections) {
      incomingByKey.add(detectionKey(d));
    }

    const result: PendingDetection[] = [...detections];
    for (const key of retained) {
      if (!incomingByKey.has(key)) {
        // eslint-disable-next-line security/detect-object-injection -- key is from retainedKeys, a controlled string array
        const data = retainedData[key];
        if (data) {
          result.push(data);
        }
      }
    }

    // Sort newest first so new detections appear on the left
    result.sort((a, b) => b.firstDetected - a.firstDetected);
    return result;
  });

  let hasDisplayDetections = $derived(displayDetections.length > 0);
  let activeDetections = $derived(displayDetections.filter(d => d.status === 'active'));
  let totalHits = $derived(
    activeDetections.reduce((sum, detection) => sum + (detection.hitCount ?? 1), 0)
  );
  let sourceCount = $derived(new Set(displayDetections.map(d => d.source).filter(Boolean)).size);
  let statusKind = $derived.by(() => {
    if (!isViewingToday) return 'historical';
    if (!isOnline) return 'offline';
    if (updatesPaused) return 'paused';
    if (streamState === 'connecting') return 'connecting';
    if (streamState === 'reconnecting') return 'reconnecting';
    if (activeDetections.length > 0) return 'live';
    return 'quiet';
  });

  // Compute relative time string from Unix timestamp
  function getElapsedText(firstDetected: number): string {
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - firstDetected));
    if (elapsed < 60) return `${elapsed}s`;
    const minutes = Math.floor(elapsed / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }

  // Refresh elapsed times every second
  let tick = $state(0);
  $effect(() => {
    if (!hasDisplayDetections) return;
    const interval = setInterval(() => {
      tick++;
    }, 1000);
    return () => clearInterval(interval);
  });

  // Force re-evaluation of elapsed text when tick changes
  let elapsedTexts = $derived.by(() => {
    void tick;
    const result: Record<string, string> = {};
    for (const d of displayDetections) {
      result[detectionKey(d)] = getElapsedText(d.firstDetected);
    }
    return result;
  });

  function getElapsedForKey(key: string): string {
    // eslint-disable-next-line security/detect-object-injection -- key is a controlled detection key string
    return elapsedTexts[key] ?? '';
  }

  // Show source column only when multiple sources are present
  let hasMultipleSources = $derived(new Set(displayDetections.map(d => d.source)).size > 1);

  function statusLabel(kind: string): string {
    switch (kind) {
      case 'historical':
        return t('dashboard.currentlyHearing.status.historical');
      case 'offline':
        return t('dashboard.currentlyHearing.status.offline');
      case 'paused':
        return t('dashboard.currentlyHearing.status.paused');
      case 'connecting':
        return t('dashboard.currentlyHearing.status.connecting');
      case 'reconnecting':
        return t('dashboard.currentlyHearing.status.reconnecting');
      case 'live':
        return t('dashboard.currentlyHearing.status.live');
      default:
        return t('dashboard.currentlyHearing.status.quiet');
    }
  }

  function statusClass(kind: string): string {
    switch (kind) {
      case 'live':
        return 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]';
      case 'quiet':
        return 'border-[var(--color-primary)]/20 bg-[var(--color-primary)]/10 text-[var(--color-primary)]';
      case 'offline':
      case 'reconnecting':
        return 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]';
      case 'paused':
      case 'historical':
      case 'connecting':
      default:
        return 'border-[var(--color-base-content)]/10 bg-[var(--color-base-200)] text-[var(--color-base-content)]/70';
    }
  }

  // Clean up pending timers on component destroy
  $effect(() => {
    return () => {
      for (const key in removalTimers) {
        // eslint-disable-next-line security/detect-object-injection -- key is from for-in over own Record
        clearTimeout(removalTimers[key]);
      }
    };
  });
</script>

<section
  class="card col-span-12 flex h-full flex-col overflow-hidden rounded-xl border border-border-100 bg-[var(--color-base-100)] shadow-xs {className}"
  aria-live="polite"
>
  <!-- Card Header -->
  <div class="border-b border-[var(--color-base-200)] px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold tracking-normal">
            {t('dashboard.currentlyHearing.title')}
          </h3>
          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none {statusClass(
              statusKind
            )}"
          >
            {#if statusKind === 'offline' || statusKind === 'reconnecting'}
              <WifiOff class="size-3" />
            {:else if statusKind === 'paused'}
              <PauseCircle class="size-3" />
            {:else}
              <Radio class="size-3" />
            {/if}
            {statusLabel(statusKind)}
          </span>
        </div>
        <p class="mt-0.5 text-xs text-[var(--color-base-content)]/55">
          {t('dashboard.currentlyHearing.subtitle')}
        </p>
      </div>

      <div class="flex items-center gap-3 text-xs text-[var(--color-base-content)]/60">
        <span class="tabular-nums">
          {activeDetections.length}
          {t('dashboard.currentlyHearing.metrics.active')}
        </span>
        <span class="tabular-nums">
          {totalHits}
          {t('dashboard.currentlyHearing.metrics.hits')}
        </span>
        {#if sourceCount > 0}
          <span class="tabular-nums">
            {sourceCount}
            {t('dashboard.currentlyHearing.metrics.sources')}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Card Content -->
  {#if hasDisplayDetections}
    <div class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each displayDetections as detection (`${detection.source}_${detection.scientificName}`)}
        {@const key = detection.source + detection.scientificName}
        {@const elapsedText = getElapsedForKey(key)}
        <div
          class="hearing-chip relative flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all duration-300
            {detection.status === 'approved'
            ? 'border border-[var(--color-success)]/35 bg-[var(--color-success)]/10'
            : detection.status === 'rejected'
              ? 'border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 opacity-60'
              : 'is-active border border-[var(--color-primary)]/25 bg-[var(--color-base-200)]'}"
          in:scale={{ duration: 260, start: 0.85, easing: quintOut }}
          out:fade={{ duration: 200 }}
        >
          {#if detection.status === 'active'}
            <span
              aria-hidden="true"
              class="active-pulse absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]"
            ></span>
          {/if}
          <!-- Thumbnail -->
          {#if detection.thumbnail}
            <img
              src={buildAppUrl(detection.thumbnail)}
              alt={detection.species}
              class="h-11 aspect-[4/3] shrink-0 rounded-md object-cover ring-1 ring-[var(--color-base-content)]/10"
            />
          {:else}
            <div
              class="flex h-11 aspect-[4/3] shrink-0 items-center justify-center rounded-md bg-[var(--color-base-content)]/10 text-xs font-bold text-[var(--color-base-content)]/50"
            >
              {detection.species.slice(0, 2).toUpperCase()}
            </div>
          {/if}

          <!-- Species info -->
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate text-sm font-semibold leading-tight text-[var(--color-base-content)]"
            >
              {detection.species}
            </span>
            <span class="truncate text-xs text-[var(--color-base-content)]/60">
              {elapsedText}
              {#if hasMultipleSources}
                · {detection.source}
              {/if}
            </span>
          </div>

          <!-- Hit count badge (when species heard multiple times in pending window) -->
          {#if detection.status === 'active' && (detection.hitCount ?? 0) > 1}
            <span
              class="ml-0.5 shrink-0 rounded-full bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--color-primary)]"
              title={t('dashboard.currentlyHearing.hitCount', { count: detection.hitCount ?? 0 })}
            >
              ×{detection.hitCount}
            </span>
          {/if}
          <!-- Status indicator -->
          {#if detection.status === 'approved'}
            <span
              in:scale={{ duration: 240, start: 0.4, easing: quintOut }}
              class="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-success)] text-white"
            >
              <Check aria-label={t('dashboard.approved')} class="h-3.5 w-3.5" />
            </span>
          {:else if detection.status === 'rejected'}
            <span
              in:scale={{ duration: 240, start: 0.4, easing: quintOut }}
              class="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-error)]/80 text-white"
            >
              <X aria-label={t('dashboard.rejected')} class="h-3.5 w-3.5" />
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center px-4 py-6">
      <div class="flex max-w-md items-center gap-3 text-left">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-base-200)] text-[var(--color-base-content)]/55"
          aria-hidden="true"
        >
          {#if statusKind === 'offline' || statusKind === 'reconnecting'}
            <WifiOff class="size-4" />
          {:else}
            <Radio class="size-4" />
          {/if}
        </span>
        <div>
          <p class="text-sm font-medium text-[var(--color-base-content)]/75">
            {statusLabel(statusKind)}
          </p>
          <p class="text-xs text-[var(--color-base-content)]/50">
            {t('dashboard.currentlyHearing.empty')}
          </p>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .active-pulse {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 20%, transparent);
    animation: hearingPulse 1.8s ease-out infinite;
  }

  @keyframes hearingPulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 32%, transparent);
    }

    100% {
      box-shadow: 0 0 0 8px color-mix(in srgb, var(--color-primary) 0%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .active-pulse {
      animation: none;
    }

    .hearing-chip {
      transition: none;
    }
  }
</style>
