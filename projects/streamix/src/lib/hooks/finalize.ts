import { AbstractStream } from '../abstractions';
import { AbstractHook } from '../abstractions/hook';


export class FinalizeHook extends AbstractHook {

  constructor(private callback: () => (void | Promise<void>)) {
    super();
  }

  override async process(stream: AbstractStream, params?: any): Promise<void> {
    return this.callback();
  }
}

export function finalize(callback: () => (void | Promise<void>)) {
  return new FinalizeHook(callback);
}

