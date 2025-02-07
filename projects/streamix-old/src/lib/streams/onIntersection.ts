import { createEmission, createStream, Stream } from '../abstractions';

/**
 * Creates a Stream using `IntersectionObserver` for observing element visibility changes.
 * Uses eventBus for emissions.
 *
 * @param element - The DOM element to observe for visibility changes.
 * @param options - Options to configure `IntersectionObserver`.
 * @returns A reactive Stream that emits boolean values for visibility changes.
 *
 * @example
 * // Example usage:
 * import { onIntersection } from './your-path';
 *
 * const elementToObserve = document.getElementById('observeMe');
 * const intersectionStream = onIntersection(elementToObserve, {
 *   threshold: 0.5,
 * });
 *
 * const subscription = intersectionStream({
 *   next: (isVisible) => {
 *     console.log('Element visibility status:', isVisible);
 *   },
 * });
 */
export function onIntersection(
  element: Element,
  options?: IntersectionObserverInit
): Stream<boolean> {
  const stream = createStream<boolean>('onIntersection', async function (this: Stream<boolean>) {
    let observer: IntersectionObserver;

    // Define the callback for IntersectionObserver
    const callback = (entries: IntersectionObserverEntry[]) => {
      const isVisible = entries[0]?.isIntersecting ?? false; // Extract visibility status
      const emission = createEmission({ value: isVisible });
      this.next(emission);
    };

    // Initialize the IntersectionObserver
    observer = new IntersectionObserver(callback, options);

    // Start observing the provided DOM element
    observer.observe(element);

    await this.awaitCompletion();

    observer.unobserve(element);
    observer.disconnect();
  });

  return stream;
}
