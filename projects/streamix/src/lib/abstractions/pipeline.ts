import { Chunk, Emission, Stream } from '../abstractions';
import { hook, HookType, PromisifiedType } from '../utils';
import { Operator } from './operator';
import { Subscribable } from './subscribable';
import { Subscription } from './subscription';

export class Pipeline<T = any> implements Subscribable<T> {
  private chunks: Chunk<T>[] = [];
  private operators: Operator[] = [];
  private onPipelineError: HookType;

  constructor(stream: Stream<T>) {
    const chunk = new Chunk(stream);
    this.chunks.push(chunk);
    this.onPipelineError = hook();
  }

  get onStart(): HookType {
    return this.first.onStart;
  }

  get onComplete(): HookType {
    return this.last.onComplete;
  }

  get onStop(): HookType {
    return this.last.onStop;
  }

  get onError(): HookType {
    return this.onPipelineError;
  }

  get onEmission(): HookType {
    return this.last.onEmission;
  }

  start() {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      this.chunks[i].start();
    }
  }

  run(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  emit({ emission, source }: { emission: Emission; source: any; }): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async errorCallback(error: any) {
    await this.onPipelineError.process(error);
  }

  private applyOperators(...operators: Operator[]): void {
    this.operators = operators;
    let currentChunk = this.first;
    let chunkOperators: Operator[] = [];

    operators.forEach(operator => {
      if (operator instanceof Operator) {
        operator = operator.clone();
        chunkOperators.push(operator);

        if ('outerStream' in operator) {
          currentChunk.pipe(...chunkOperators);
          chunkOperators = [];
          currentChunk = new Chunk(operator.outerStream as any);
          this.chunks.push(currentChunk);
        }
      }
    });

    currentChunk.pipe(...chunkOperators);

    this.chunks.forEach(chunk => {
      chunk.onError.chain(this, this.errorCallback);
    });
  }

  pipe(...operators: Operator[]): Subscribable<T> {
    // Create a new Pipeline instance with the existing streams and new operators
    const newPipeline = new Pipeline<T>(this.first);
    newPipeline.applyOperators(...this.operators, ...operators)
    return newPipeline;
  }

  get isAutoComplete(): PromisifiedType<boolean> {
    return this.last.isAutoComplete;
  }
  get isCancelled(): PromisifiedType<boolean> {
    return this.last.isCancelled;
  }
  get isStopRequested(): PromisifiedType<boolean> {
    return this.last.isStopRequested;
  }
  get isFailed(): PromisifiedType<any> {
    return this.last.isFailed;
  }
  get isStopped(): PromisifiedType<boolean> {
    return this.last.isStopped;
  }
  get isUnsubscribed(): PromisifiedType<boolean> {
    return this.last.isUnsubscribed;
  }
  get isRunning(): PromisifiedType<boolean> {
    return this.last.isRunning;
  }
  get subscribers(): HookType {
    return this.last.subscribers;
  }
  shouldTerminate(): boolean {
    return this.last.shouldTerminate();
  }
  awaitTermination(): Promise<void> {
    return this.last.awaitTermination();
  }
  terminate(): Promise<void> {
    return this.last.terminate();
  }
  shouldComplete(): boolean {
    return this.last.shouldComplete();
  }
  awaitCompletion(): Promise<void> {
    return this.last.awaitCompletion();
  }
  complete(): Promise<void> {
    return this.last.complete();
  }

  subscribe(callback?: (value: T) => any): Subscription {
    const subscriptions: Subscription[] = [];
    const defaultCallback = () => {};
    callback = callback ?? defaultCallback;

    const subscribeToStream = (stream: Subscribable<T>, cb: (value: T) => any): Subscription => {
      const subscription = stream.subscribe(cb);
      subscriptions.push(subscription);
      return subscription;
    };


    for (let i = this.chunks.length - 1; i >= 0; i--) {
      subscribeToStream(this.chunks[i], i === this.chunks.length - 1 ? callback : defaultCallback);
    }

    return {
      unsubscribe: () => {
        subscriptions.forEach(subscription => subscription.unsubscribe());
      }
    };
  }

  private get first(): Chunk<T> {
    return this.chunks[0];
  }

  private get last(): Chunk<T> {
    return this.chunks[this.chunks.length - 1];
  }
}
