<!--
  YardList.svelte

  Lifetime list of every species ever detected, with the date each one was
  first heard. Modeled after a birder's "yard list" — chronological by default,
  with sort and search for casual browsing.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowDown, ArrowUp, Bird, Search } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import { api } from '$lib/utils/api';
  import { getLogger } from '$lib/utils/logger';
  import { formatNumber } from '$lib/utils/formatters';
  import { buildAppUrl } from '$lib/utils/urlHelpers';
  import { handleBirdImageError } from '$lib/desktop/components/ui/image-utils';

  const logger = getLogger('app');

  interface SpeciesSummary {
    scientific_name: string;
    common_name: string;
    species_code?: string;
    count: number;
    first_heard?: string;
    last_heard?: string;
    avg_confidence?: number;
    max_confidence?: number;
    thumbnail_url?: string;
  }

  type SortKey = 'first_heard' | 'last_heard' | 'common_name' | 'count';
  type SortDir = 'asc' | 'desc';

  let species = $state<SpeciesSummary[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let query = $state('');
  let sortKey = $state<SortKey>('first_heard');
  let sortDir = $state<SortDir>('asc');

  onMount(() => {
    void load();
  });

  async function load() {
    isLoading = true;
    error = null;
    try {
      const data = await api.get<SpeciesSummary[]>('/api/v2/analytics/species/summary');
      species = Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error('Failed to load yard list', err, { action: 'load' });
      error = t('analytics.yardList.loadError');
      species = [];
    } finally {
      isLoading = false;
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      // First-heard defaults to chronological (oldest first); other keys to descending.
      sortDir = key === 'first_heard' ? 'asc' : 'desc';
    }
  }

  function compareDates(a: string | undefined, b: string | undefined, dir: SortDir): number {
    const ta = a ? new Date(a).getTime() : 0;
    const tb = b ? new Date(b).getTime() : 0;
    return dir === 'asc' ? ta - tb : tb - ta;
  }

  function compareNumbers(a: number, b: number, dir: SortDir): number {
    return dir === 'asc' ? a - b : b - a;
  }

  function compareStrings(a: string, b: string, dir: SortDir): number {
    const cmp = a.localeCompare(b);
    return dir === 'asc' ? cmp : -cmp;
  }

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? species.filter(
          s =>
            s.common_name.toLowerCase().includes(q) || s.scientific_name.toLowerCase().includes(q)
        )
      : species.slice();
    list.sort((a, b) => {
      switch (sortKey) {
        case 'first_heard':
          return compareDates(a.first_heard, b.first_heard, sortDir);
        case 'last_heard':
          return compareDates(a.last_heard, b.last_heard, sortDir);
        case 'count':
          return compareNumbers(a.count, b.count, sortDir);
        case 'common_name':
          return compareStrings(a.common_name, b.common_name, sortDir);
      }
    });
    return list;
  });

  function formatDateOnly(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function speciesThumb(sci: string): string {
    return buildAppUrl(`/api/v2/media/species-image?name=${encodeURIComponent(sci)}`);
  }
</script>

<svelte:head>
  <title>{t('analytics.yardList.pageTitle')}</title>
</svelte:head>

<div class="col-span-12 space-y-4" role="region" aria-label={t('analytics.yardList.title')}>
  <!-- Header -->
  <div class="card bg-[var(--color-base-100)] shadow-xs">
    <div
      class="card-body card-padding flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
        >
          <Bird class="h-5 w-5" />
        </div>
        <div>
          <h1 class="card-title">{t('analytics.yardList.title')}</h1>
          <p class="text-sm text-[var(--color-base-content)]/60">
            {t('analytics.yardList.subtitle')}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs uppercase tracking-wider text-[var(--color-base-content)]/55">
          {t('analytics.yardList.totalSpecies')}
        </span>
        <span class="text-2xl font-semibold tabular-nums">{formatNumber(species.length)}</span>
      </div>
    </div>
  </div>

  <!-- Search + list -->
  <div class="card bg-[var(--color-base-100)] shadow-xs">
    <div class="card-body card-padding">
      <div class="mb-3 flex items-center gap-2">
        <div class="relative w-full max-w-sm">
          <Search
            class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-base-content)]/40"
          />
          <input
            type="search"
            class="input w-full pl-8"
            placeholder={t('analytics.yardList.searchPlaceholder')}
            bind:value={query}
            aria-label={t('analytics.yardList.searchPlaceholder')}
          />
        </div>
      </div>

      {#if isLoading}
        <div class="flex items-center justify-center py-12" role="status" aria-live="polite">
          <span class="loading loading-spinner loading-md text-[var(--color-primary)]"></span>
          <span class="ml-3 text-sm text-[var(--color-base-content)]/60">
            {t('analytics.yardList.loading')}
          </span>
        </div>
      {:else if error}
        <div class="alert alert-error">{error}</div>
      {:else if filtered.length === 0}
        <div class="py-12 text-center text-sm text-[var(--color-base-content)]/60">
          {query ? t('analytics.yardList.noMatch') : t('analytics.yardList.empty')}
        </div>
      {:else}
        <!-- Desktop table -->
        <div class="overflow-x-auto hidden md:block">
          <table class="table w-full">
            <thead>
              <tr>
                <th class="w-12"></th>
                <th>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-primary)]"
                    onclick={() => toggleSort('common_name')}
                  >
                    {t('analytics.yardList.columns.species')}
                    {#if sortKey === 'common_name'}
                      {#if sortDir === 'asc'}<ArrowUp class="h-3.5 w-3.5" />{:else}<ArrowDown
                          class="h-3.5 w-3.5"
                        />{/if}
                    {/if}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-primary)]"
                    onclick={() => toggleSort('first_heard')}
                  >
                    {t('analytics.yardList.columns.firstSeen')}
                    {#if sortKey === 'first_heard'}
                      {#if sortDir === 'asc'}<ArrowUp class="h-3.5 w-3.5" />{:else}<ArrowDown
                          class="h-3.5 w-3.5"
                        />{/if}
                    {/if}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-primary)]"
                    onclick={() => toggleSort('last_heard')}
                  >
                    {t('analytics.yardList.columns.lastSeen')}
                    {#if sortKey === 'last_heard'}
                      {#if sortDir === 'asc'}<ArrowUp class="h-3.5 w-3.5" />{:else}<ArrowDown
                          class="h-3.5 w-3.5"
                        />{/if}
                    {/if}
                  </button>
                </th>
                <th class="text-right">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-primary)]"
                    onclick={() => toggleSort('count')}
                  >
                    {t('analytics.yardList.columns.count')}
                    {#if sortKey === 'count'}
                      {#if sortDir === 'asc'}<ArrowUp class="h-3.5 w-3.5" />{:else}<ArrowDown
                          class="h-3.5 w-3.5"
                        />{/if}
                    {/if}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {#each filtered as s (s.scientific_name)}
                <tr class="hover:bg-[var(--color-base-200)]/60">
                  <td>
                    <div class="h-8 w-8 overflow-hidden rounded-full bg-[var(--color-base-200)]">
                      <img
                        src={s.thumbnail_url || speciesThumb(s.scientific_name)}
                        alt={s.common_name}
                        class="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onerror={handleBirdImageError}
                      />
                    </div>
                  </td>
                  <td>
                    <div class="font-medium">{s.common_name}</div>
                    <div class="text-xs italic text-[var(--color-base-content)]/55">
                      {s.scientific_name}
                    </div>
                  </td>
                  <td class="tabular-nums">{formatDateOnly(s.first_heard)}</td>
                  <td class="tabular-nums text-[var(--color-base-content)]/70">
                    {formatDateOnly(s.last_heard)}
                  </td>
                  <td class="tabular-nums text-right">{formatNumber(s.count)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Mobile list -->
        <ul class="md:hidden space-y-2">
          {#each filtered as s (s.scientific_name)}
            <li class="flex items-center gap-3 rounded-lg bg-[var(--color-base-100)] p-2.5">
              <div class="h-9 w-9 overflow-hidden rounded-full bg-[var(--color-base-200)] shrink-0">
                <img
                  src={s.thumbnail_url || speciesThumb(s.scientific_name)}
                  alt={s.common_name}
                  class="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onerror={handleBirdImageError}
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{s.common_name}</div>
                <div class="truncate text-xs italic text-[var(--color-base-content)]/55">
                  {s.scientific_name}
                </div>
                <div
                  class="mt-1 flex items-center gap-3 text-xs text-[var(--color-base-content)]/65 tabular-nums"
                >
                  <span>{formatDateOnly(s.first_heard)}</span>
                  <span class="ml-auto">{formatNumber(s.count)}</span>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .card-padding {
    padding: 1rem;
  }

  @media (min-width: 768px) {
    .card-padding {
      padding: 1.25rem;
    }
  }
</style>
