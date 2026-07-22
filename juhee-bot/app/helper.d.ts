export declare class Style {
    ttl: unknown;
    dp: unknown;
    constructor(styleTtlOnnx: unknown, styleDpOnnx: unknown);
}

export declare class TextToSpeech {
    sampleRate: number;
    baseChunkSize: number;
    chunkCompressFactor: number;
    ldim: number;

    sampleNoisyLatent(duration: number[]): {
        noisyLatent: number[][][];
        latentMask: number[][][];
    };

    call(
        text: string,
        lang: string,
        style: Style,
        totalStep: number,
        speed?: number,
        silenceDuration?: number
    ): Promise<{ wav: ArrayLike<number>; duration: number[] }>;

    batch(
        textList: string[],
        langList: string[],
        style: Style,
        totalStep: number,
        speed?: number
    ): Promise<{ wav: ArrayLike<number>; duration: number[] }>;
}

export declare function loadVoiceStyle(voiceStylePaths: string[], verbose?: boolean): Style;

export declare function loadTextToSpeech(onnxDir: string, useGpu?: boolean): Promise<TextToSpeech>;

export declare function writeWavFile(filename: string, audioData: number[], sampleRate: number): void;

export declare function timer<T>(name: string, fn: () => Promise<T>): Promise<T>;

export declare function sanitizeFilename(text: string, maxLen: number): string;
