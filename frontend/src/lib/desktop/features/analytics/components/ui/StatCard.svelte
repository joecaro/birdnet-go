<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    value: string | number;
    subtitle?: string;
    icon?: Snippet;
    iconClassName?: string;
    className?: string;
    valueClassName?: string;
    isLoading?: boolean;
  }

  let {
    title,
    value,
    subtitle,
    icon,
    iconClassName = '',
    className = '',
    valueClassName = '',
    isLoading = false,
  }: Props = $props();
</script>

<div
  class={cn(
    'card bg-[var(--color-base-100)] rounded-xl border border-[var(--border-100)]',
    className
  )}
>
  <div class="card-body p-3.5 md:p-4">
    <h2 class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-base-content)]/55">
      {title}
    </h2>
    <div class="mt-2 flex items-center gap-3">
      {#if icon}
        <div
          class={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            iconClassName
          )}
        >
          {@render icon()}
        </div>
      {/if}
      <div class="min-w-0">
        <div class={cn('text-2xl font-semibold leading-tight tabular-nums tracking-tight', valueClassName)}>
          {isLoading ? '…' : value}
        </div>
        {#if subtitle}
          <div class="mt-0.5 text-xs text-[var(--color-base-content)]/55 truncate">
            {subtitle}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
