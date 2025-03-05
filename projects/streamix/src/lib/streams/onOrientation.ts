import { createSubscription } from '../abstractions';
import { createSubject } from '../streams';
/**
 * Creates a subscription that emits orientation changes.
 *
 * @returns A Subscription function that returns "portrait" or "landscape".
 */
export function onOrientation() {
  if (!window.screen || !window.screen.orientation) {
    console.warn("Screen orientation API is not supported in this environment");
    return createSubscription(() => "portrait"); // Fallback for unsupported environments
  }

  const subject = createSubject<"portrait" | "landscape">();
  const getOrientation = () =>
    window.screen.orientation.angle === 0 || window.screen.orientation.angle === 180
      ? "portrait"
      : "landscape";

  let latestOrientation: "portrait" | "landscape" = getOrientation();

  const listener = () => {
    latestOrientation = getOrientation();
    subject.next(latestOrientation);
  };

  window.screen.orientation.addEventListener("change", listener);

  return createSubscription(() => subject.value(), () => {
    window.screen.orientation.removeEventListener("change", listener);
    subject.complete();
  });
}
