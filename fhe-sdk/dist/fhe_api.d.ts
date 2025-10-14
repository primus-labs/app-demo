type AlgorithmBackend = "auto" | "native" | "wasm";
export declare const init: (mode?: AlgorithmBackend) => Promise<void>;
export declare const getCiphertext: (pk: Buffer, input: Uint8Array) => Promise<Uint8Array<ArrayBufferLike>>;
export declare function encryptInteger(pkFile: string, input: Uint8Array): Promise<Uint8Array>;
export {};
//# sourceMappingURL=fhe_api.d.ts.map