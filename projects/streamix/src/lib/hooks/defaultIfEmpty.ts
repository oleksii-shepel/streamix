import { Emission, Subscribable, Stream } from '../abstractions';

export const defaultIfEmpty = (defaultValue: any) => {
  let boundStream: Stream;
  let hasEmitted = false;

  const init = (stream: Stream) => {
    boundStream = stream;
    boundStream.onComplete.chain(callback); // Chain the callback to be triggered on stream completion
  };

  const callback = async (): Promise<void> => {
    if (!hasEmitted) {
      // If nothing has been emitted, emit the default value
      return boundStream.onEmission.process({ emission: { value: defaultValue }, source: null });
    }
  };

  const handle = async (emission: Emission, stream: Subscribable): Promise<Emission> => {
    // Mark the emission if it's not a phantom or failed
    if (!emission.isPhantom && !emission.isFailed) {
      hasEmitted = true;
    }
    return emission; // Pass the emission forward
  };

  return {
    init,
    handle
  };
};
