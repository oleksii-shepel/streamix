import { AbstractStream } from '../abstractions';
import { Emission } from '../abstractions/emission';
import { AbstractOperator } from '../abstractions/operator';

export class TapOperator extends AbstractOperator {
  private readonly tapFunction: (value: any) => void;

  constructor(tapFunction: (value: any) => void) {
    super();
    this.tapFunction = tapFunction;
  }

  async handle(emission: Emission, stream: AbstractStream): Promise<Emission> {
    try {
      this.tapFunction(emission.value);
    } catch (error: any) {
      emission.isFailed = true;
      emission.error = error;
      return emission;
    }

    return emission;
  }
}

export function tap(tapFunction: (value: any) => void) {
  return new TapOperator(tapFunction);
}
