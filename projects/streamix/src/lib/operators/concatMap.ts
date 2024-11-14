import { Subscribable, Emission, createOperator, Operator } from '../abstractions';
import { CounterType, counter } from '../utils';
import { createSubject } from '../streams';
import { Subscription } from '../abstractions';

export const concatMap = (project: (value: any) => Subscribable): Operator => {
  let currentInnerStream: Subscribable | null = null;
  let emissionQueue: Emission[] = [];
  let pendingEmissions: number = 0;
  const executionCounter: CounterType = counter(0);
  let isFinalizing: boolean = false;
  let inputStream!: Subscribable | undefined;
  let subscription: Subscription | undefined;
  const outputStream = createSubject();

  const init = (stream: Subscribable) => {
    inputStream = stream;
    inputStream.onStop.once(() => {
      executionCounter.waitFor(pendingEmissions).then(finalize);
    });
    outputStream.onStop.once(finalize);
  };

  const handle = async (emission: Emission, stream: Subscribable) => {
    emissionQueue.push(emission);
    pendingEmissions++;

    if(!currentInnerStream) {
      await processQueue();
    }

    emission.isPhantom = true;
    return emission;
  };

  const processQueue = async (): Promise<void> => {
    while (emissionQueue.length > 0 && !isFinalizing) {
      const nextEmission = emissionQueue.shift();
      if (nextEmission) {
        await processEmission(nextEmission);
      }
    }
  };

  const processEmission = async (emission: Emission): Promise<void> => {
    currentInnerStream = project(emission.value);

    if (currentInnerStream) {
      // Immediately set up listeners on the new inner stream
      currentInnerStream.onError.once((error: any) => handleStreamError(emission, error));

      currentInnerStream.onStop.once(() => completeInnerStream(subscription!));

      subscription = currentInnerStream.subscribe((value) => handleInnerEmission(value));
    }
  };

  const handleInnerEmission = (value: any) => {
    outputStream.next(value);
  };

  const completeInnerStream = async (subscription: Subscription) => {
    subscription?.unsubscribe();
    await processQueue();
    executionCounter.increment();
  };

  const handleStreamError = (emission: Emission, error: any) => {
    emission.error = error;
    emission.isFailed = true;
    stopStreams(currentInnerStream, outputStream);
    executionCounter.increment();
  };

  const finalize = async () => {
    if (isFinalizing) return;
    isFinalizing = true;

    await stopStreams(currentInnerStream, inputStream, outputStream);
    currentInnerStream = null;
  };

  const stopStreams = async (...streams: (Subscribable | null | undefined)[]) => {
    await Promise.all(
      streams.filter(stream => stream?.isRunning).map(stream => stream!.complete())
    );
  };

  const operator = createOperator(handle) as any;
  operator.name = 'concatMap';
  operator.init = init;
  operator.stream = outputStream;

  return operator;
};
