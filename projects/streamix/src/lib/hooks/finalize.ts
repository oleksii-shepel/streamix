import { AbstractOperator, AbstractStream, Emission } from '../abstractions';
import { Hook } from '../abstractions/hook';


export class FinalizeOperator extends AbstractOperator implements Hook {

  constructor(private callbackMethod: () => (void | Promise<void>)) {
    super();
  }

  async callback({ stream, error }: any): Promise<void> {
    return this.callbackMethod();
  }

  override async handle(emission: Emission, stream: AbstractStream): Promise<Emission> {
    return emission;
  }
}

export function finalize(callback: () => (void | Promise<void>)) {
  return new FinalizeOperator(callback);
}

