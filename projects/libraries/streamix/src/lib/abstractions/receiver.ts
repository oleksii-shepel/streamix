export type Receiver<T = any> = {
  value?: () => T | undefined;
  next?: (value: T) => void;
  error?: (err: Error) => void;
  complete?: () => void;
  unsubscribed?: boolean;
  completed?: boolean;
  unsubscribe?: () => void;
};

export function createReceiver<T = any>(callbackOrReceiver?: ((value: T) => void) | Receiver<T>): Required<Receiver<T>> {
  const receiver = (typeof callbackOrReceiver === 'function' ?
    { next: callbackOrReceiver } :
    callbackOrReceiver || {}) as Required<Receiver<T>>;

  let latestValue: T | undefined;

  receiver.unsubscribed = false;
  receiver.completed = false;

  receiver.value = () => latestValue;

  const originalNext = receiver.next;
  const originalComplete = receiver.complete;
  const originalUnsubscribe = receiver.unsubscribe;

  receiver.next = function (this: Receiver, value: T) { latestValue = value; originalNext?.call(this, value); }
  receiver.error = receiver.error ?? ((err) => console.error('Unhandled error:', err));
  receiver.complete = function (this: Receiver) { this.completed = true; originalComplete?.call(this); };
  receiver.unsubscribe = function (this: Receiver) { this.unsubscribed = true; originalUnsubscribe?.call(this); };

  return receiver;
}
