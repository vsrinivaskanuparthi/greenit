declare module "@tgwf/co2" {
  export class co2 {
    constructor(options: { model: "swd"; version: 4 });
    perByte(bytes: number, green: boolean): number;
  }
}
