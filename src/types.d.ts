declare module 'qrcode-terminal' {
  interface Options {
    small?: boolean;
  }
  function generate(text: string, opts?: Options): void;
  export = { generate };
}
