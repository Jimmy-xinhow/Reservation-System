declare module "sharp" {
  interface PngOptions {
    compressionLevel?: number;
    palette?: boolean;
    quality?: number;
  }

  interface SharpPipeline {
    png(options?: PngOptions): SharpPipeline;
    composite(inputs: Array<{ input: Buffer; left: number; top: number }>): SharpPipeline;
    toBuffer(): Promise<Buffer>;
  }

  interface TextImageInput {
    text: string;
    font?: string;
    fontfile?: string;
    width?: number;
    height?: number;
    align?: "left" | "centre" | "center" | "right";
    rgba?: boolean;
  }

  function sharp(input: Buffer | Uint8Array | string | { text: TextImageInput }): SharpPipeline;
  export default sharp;
}
