declare module "sharp" {
  interface PngOptions {
    compressionLevel?: number;
    palette?: boolean;
    quality?: number;
    colours?: number;
  }

  interface SharpPipeline {
    resize(width: number, height: number, options?: { fit?: "cover" | "contain" | "fill" | "inside" | "outside"; position?: string }): SharpPipeline;
    png(options?: PngOptions): SharpPipeline;
    composite(inputs: Array<{ input: Buffer; left: number; top: number }>): SharpPipeline;
    toBuffer(): Promise<Buffer>;
    toFile(path: string): Promise<unknown>;
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

  interface CreateImageInput { create: { width: number; height: number; channels: 3 | 4; background: string } }
  function sharp(input: Buffer | Uint8Array | string | { text: TextImageInput } | CreateImageInput): SharpPipeline;
  export default sharp;
}
