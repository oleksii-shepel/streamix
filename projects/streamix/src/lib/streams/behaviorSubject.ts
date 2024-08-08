import { Subject } from './subject';

export class BehaviorSubject<T = any> extends Subject<T> {
  constructor(initialValue: T) {
    super();
    queueMicrotask(() => this.emissionAvailable = (() => this.isRunning.then(() => this.emissionAvailable).then(() => this.emit({ value: initialValue }, this.head!)))());
  }
}
