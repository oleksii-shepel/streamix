import { AbstractOperator, AbstractStream, Emission, StreamSink } from '../abstractions';

export class ConcatMapOperator extends AbstractOperator {
  private readonly project: (value: any) => AbstractStream;
  private queue: Emission[] = [];

  private left!: StreamSink;
  private right!: StreamSink;

  constructor(project: (value: any) => AbstractStream) {
    super();
    this.project = project;
  }

  async handle(emission: Emission, stream: AbstractStream): Promise<Emission> {

    let streamSink = stream as StreamSink;
    if (!(streamSink instanceof StreamSink)) {
      streamSink = new StreamSink(streamSink);
    }
    if (this.left === undefined) {
      const [left, right] = streamSink.split(this, streamSink);
      this.left = left;
      this.right = right;
    }

    this.queue.push(emission);
    await this.processQueue(this.right);

    emission.isPhantom = true;
    return emission;
  }

  private async processQueue(stream: AbstractStream): Promise<void> {
    while (this.queue.length > 0) {
      const emission = this.queue.shift()!;
      if(!stream.isCancelled.value && !stream.isUnsubscribed.value) {
        const innerStream = this.project(emission.value);

        try {
          await this.processInnerStream(innerStream, stream);
        } catch (error) {
          emission.error = error;
          emission.isFailed = true;
        }
      }
      else if (stream.isCancelled.value) {
        emission.isCancelled = true;
      }
    }
  }

  private async processInnerStream(innerStream: AbstractStream, stream: AbstractStream): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const subscription = innerStream.subscribe(async (value) => {
        if(!stream.isCancelled.value && !stream.isUnsubscribed.value) {
          await this.right.emit({ value }).catch(reject);
        }
      });

      innerStream.isFailed.promise.then((error) => {
        subscription.unsubscribe();
        reject(error);
      });

      innerStream.isStopped.promise.then(() => {
        subscription.unsubscribe();
        resolve();
      }).catch(reject);

      // Handle stream cancellation and stop requests
      stream.isCancelled.promise.then(() => {
        subscription.unsubscribe();
        resolve();
      });
      stream.isStopRequested.promise.then(() => {
        subscription.unsubscribe();
        resolve();
      });
    });
  }
}

export function concatMap(project: (value: any) => AbstractStream) {
  return new ConcatMapOperator(project);
}
