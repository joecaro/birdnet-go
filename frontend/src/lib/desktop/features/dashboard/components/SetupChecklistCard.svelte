<!--
  SetupChecklistCard.svelte

  First-run helper that surfaces gaps in essential configuration on the
  dashboard. Reads settings store reactively so checks update as the user
  configures things in another tab. Renders nothing once every required
  step is complete, so it disappears for fully-configured installs without
  any user dismissal needed.
-->
<script lang="ts">
  import { CheckCircle2, Circle, ArrowRight } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import {
    audioSettings,
    birdnetSettings,
    settingsStore,
    settingsActions,
  } from '$lib/stores/settings';
  import { navigation } from '$lib/stores/navigation.svelte';
  import { onMount } from 'svelte';

  interface ChecklistItem {
    key: string;
    label: string;
    href: string;
    done: boolean;
  }

  // Trigger settings load once if the store hasn't been hydrated yet.
  onMount(() => {
    if (!$settingsStore.dataLoaded && !$settingsStore.isLoading) {
      settingsActions.loadSettings();
    }
  });

  let audioConfigured = $derived(($audioSettings?.sources?.length ?? 0) > 0);
  let locationConfigured = $derived($birdnetSettings?.locationConfigured === true);

  let items: ChecklistItem[] = $derived([
    {
      key: 'audio',
      label: t('dashboard.setup.audio'),
      href: '/ui/settings/audio',
      done: audioConfigured,
    },
    {
      key: 'location',
      label: t('dashboard.setup.location'),
      href: '/ui/settings/main',
      done: locationConfigured,
    },
  ]);

  let completedCount = $derived(items.filter(i => i.done).length);
  let totalCount = $derived(items.length);
  let allDone = $derived(completedCount === totalCount);

  let visible = $derived($settingsStore.dataLoaded && !allDone);

  function goTo(href: string) {
    navigation.navigate(href);
  }
</script>

{#if visible}
  <section
    class="mb-3 rounded-xl border border-[var(--color-warning)]/25 bg-[var(--color-base-100)] shadow-xs"
    aria-label={t('dashboard.setup.title')}
  >
    <div class="flex items-start gap-4 px-4 py-3">
      <div class="flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-semibold">{t('dashboard.setup.title')}</h3>
          <span class="text-xs text-[var(--color-base-content)]/60">
            {completedCount}/{totalCount}
          </span>
        </div>
        <p class="mt-0.5 text-xs text-[var(--color-base-content)]/55">
          {t('dashboard.setup.subtitle')}
        </p>

        <ul class="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {#each items as item (item.key)}
            <li>
              <button
                type="button"
                onclick={() => goTo(item.href)}
                class="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-xs transition-colors hover:border-[var(--color-base-content)]/10 hover:bg-[var(--color-base-200)]"
              >
                {#if item.done}
                  <CheckCircle2 class="h-4 w-4 text-[var(--color-success)]" />
                  <span class="text-[var(--color-base-content)]/60 line-through decoration-1">
                    {item.label}
                  </span>
                {:else}
                  <Circle class="h-4 w-4 text-[var(--color-base-content)]/40" />
                  <span class="font-medium">{item.label}</span>
                  <ArrowRight
                    class="ml-auto h-4 w-4 text-[var(--color-base-content)]/40 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
                  />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </section>
{/if}
