<!--
  WeatherSummaryCard.svelte

  Daily weather context for the Analytics view.
  Fetches /api/v2/weather/{daily,hourly,moon} for the given date and renders
  a compact summary: location, sunrise/sunset, latest conditions, moon phase.
  Renders nothing when no weather data is available so analytics layout
  stays clean for users without a weather provider configured.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { api } from '$lib/utils/api';
  import { getLogger } from '$lib/utils/logger';
  import { getLocalDateString } from '$lib/utils/date';
  import {
    formatTemperatureCompact,
    formatWindSpeed,
    type TemperatureUnit,
  } from '$lib/utils/formatters';
  import { extractWeatherCode, getWeatherEmoji, isNightTime } from '$lib/utils/weather';
  import { Sunrise, Sunset, Wind, Droplets, MapPin } from '@lucide/svelte';

  interface Props {
    date?: string;
    units?: TemperatureUnit;
    className?: string;
  }

  let { date = getLocalDateString(), units = 'metric', className = '' }: Props = $props();

  const logger = getLogger('app');

  interface DailyWeather {
    date: string;
    sunrise: string;
    sunset: string;
    country?: string;
    city_name?: string;
  }

  interface HourlyWeather {
    time: string;
    temperature: number;
    feels_like?: number;
    humidity?: number;
    wind_speed?: number;
    clouds?: number;
    weather_main?: string;
    weather_desc?: string;
    weather_icon?: string;
  }

  interface MoonData {
    phase: number;
    phase_name: string;
    illumination: number;
    icon_name: string;
  }

  let daily = $state<DailyWeather | null>(null);
  let latestHourly = $state<HourlyWeather | null>(null);
  let moon = $state<MoonData | null>(null);
  let isLoading = $state(true);

  $effect(() => {
    void date;
    loadWeather();
  });

  async function loadWeather() {
    isLoading = true;
    try {
      const [dailyRes, hourlyRes, moonRes] = await Promise.allSettled([
        api.get<DailyWeather>(`/api/v2/weather/daily/${date}`),
        api.get<{ data: HourlyWeather[] }>(`/api/v2/weather/hourly/${date}`),
        api.get<MoonData>(`/api/v2/weather/moon/${date}`),
      ]);

      daily = dailyRes.status === 'fulfilled' ? dailyRes.value : null;

      if (hourlyRes.status === 'fulfilled') {
        const list = hourlyRes.value?.data ?? [];
        latestHourly = list.length > 0 ? list[list.length - 1] : null;
      } else {
        latestHourly = null;
      }

      moon = moonRes.status === 'fulfilled' ? moonRes.value : null;
    } catch (err) {
      logger.error('Failed to load weather summary', err, { action: 'loadWeather', date });
    } finally {
      isLoading = false;
    }
  }

  let hasAnyData = $derived(daily !== null || latestHourly !== null || moon !== null);

  function formatTime(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  let weatherEmoji = $derived.by(() => {
    if (!latestHourly?.weather_icon) return '';
    const code = extractWeatherCode(latestHourly.weather_icon);
    return getWeatherEmoji(code, isNightTime(latestHourly.weather_icon));
  });

  let location = $derived.by(() => {
    if (!daily) return '';
    const parts = [daily.city_name, daily.country].filter(Boolean);
    return parts.join(', ');
  });
</script>

{#if isLoading}
  <div
    class="card bg-[var(--color-base-100)] shadow-xs rounded-2xl border border-[var(--color-base-200)] p-4 {className}"
    aria-busy="true"
    aria-live="polite"
  >
    <div class="flex items-center gap-3 text-sm text-[var(--color-base-content)]/60">
      <span class="loading loading-spinner loading-sm text-[var(--color-primary)]"></span>
      <span>{t('analytics.weather.loading')}</span>
    </div>
  </div>
{:else if hasAnyData}
  <div
    class="card bg-[var(--color-base-100)] shadow-xs rounded-2xl border border-[var(--color-base-200)] p-4 {className}"
  >
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <!-- Conditions -->
      {#if latestHourly}
        <div class="flex items-center gap-3">
          {#if weatherEmoji}
            <span class="text-3xl leading-none" aria-hidden="true">{weatherEmoji}</span>
          {/if}
          <div class="flex flex-col">
            <span class="text-2xl font-semibold leading-none">
              {formatTemperatureCompact(latestHourly.temperature, units)}
            </span>
            {#if latestHourly.weather_desc}
              <span class="text-xs capitalize text-[var(--color-base-content)]/60">
                {latestHourly.weather_desc}
              </span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Metrics -->
      {#if latestHourly}
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-base-content)]/80"
        >
          {#if latestHourly.wind_speed !== undefined}
            <span class="flex items-center gap-1.5">
              <Wind class="h-4 w-4 text-[var(--color-base-content)]/50" />
              {formatWindSpeed(latestHourly.wind_speed, units)}
            </span>
          {/if}
          {#if latestHourly.humidity !== undefined}
            <span class="flex items-center gap-1.5">
              <Droplets class="h-4 w-4 text-[var(--color-base-content)]/50" />
              {latestHourly.humidity}%
            </span>
          {/if}
        </div>
      {/if}

      <!-- Sun -->
      {#if daily}
        <div class="flex items-center gap-x-4 text-sm text-[var(--color-base-content)]/80">
          <span class="flex items-center gap-1.5" title={t('analytics.weather.sunrise')}>
            <Sunrise class="h-4 w-4 text-[var(--color-warning)]" />
            {formatTime(daily.sunrise)}
          </span>
          <span class="flex items-center gap-1.5" title={t('analytics.weather.sunset')}>
            <Sunset class="h-4 w-4 text-[var(--color-warning)]" />
            {formatTime(daily.sunset)}
          </span>
        </div>
      {/if}

      <!-- Moon -->
      {#if moon}
        <div
          class="flex items-center gap-2 text-sm text-[var(--color-base-content)]/80"
          title="{moon.phase_name} · {Math.round(moon.illumination)}%"
        >
          <span class="text-xl leading-none" aria-hidden="true">🌙</span>
          <span class="flex flex-col leading-tight">
            <span>{moon.phase_name}</span>
            <span class="text-xs text-[var(--color-base-content)]/60">
              {Math.round(moon.illumination)}% {t('analytics.weather.illuminated')}
            </span>
          </span>
        </div>
      {/if}

      <!-- Location -->
      {#if location}
        <div class="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-base-content)]/60">
          <MapPin class="h-3.5 w-3.5" />
          {location}
        </div>
      {/if}
    </div>
  </div>
{/if}
