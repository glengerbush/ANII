import { invalidateAll } from '$app/navigation';
import { tick } from 'svelte';

const selector = '[data-task-id]';
function visible(element: HTMLElement) {
  return element.checkVisibility();
}

/** Keep the acted-on task at its viewport offset; use nearby rows if it disappears. */
export function captureTaskPosition(taskId: number) {
  const url = location.href;
  const x = window.scrollX, y = window.scrollY;
  const cards = [...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
  const primary = cards.find(card => card.dataset.taskId === String(taskId));
  const inViewport = (card: HTMLElement) => {
    const rect = card.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  };
  const top = primary?.getBoundingClientRect().top ?? 0;
  const neighbors = cards.filter(card => card !== primary && inViewport(card))
    .sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top));
  const anchors = [...(primary && inViewport(primary) ? [primary] : []), ...neighbors]
    .map(card => ({ card, id: card.dataset.taskId, top: card.getBoundingClientRect().top, primary: card === primary }));
  const hadFocus = primary?.contains(document.activeElement);
  return async () => {
    await tick();
    if (location.href !== url) return;
    const current = [...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
    for (const anchor of anchors) {
      const card = current.includes(anchor.card) ? anchor.card : current.find(card => card.dataset.taskId === anchor.id);
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      // Closing a tall editor should not leave its collapsed task above the viewport.
      const offset = anchor.primary && anchor.top + rect.height <= 0 ? 16 : anchor.top;
      window.scrollTo({ left: x, top: window.scrollY + rect.top - offset, behavior: 'instant' });
      if (hadFocus && document.activeElement === document.body) {
        card.querySelector<HTMLElement>('button.task-title, .completion-checkbox')?.focus({ preventScroll: true });
      }
      return;
    }
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  };
}

export async function refreshTask(taskId: number) {
  const restore = captureTaskPosition(taskId);
  await invalidateAll();
  await restore();
}
