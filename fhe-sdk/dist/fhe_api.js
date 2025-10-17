"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCiphertext = exports.init = void 0;
exports.encryptInteger = encryptInteger;
const fs_1 = __importDefault(require("fs"));
const MAX_NATIVE_OUTPUT_SIZE = 100_000_000;
async function loadWasmEncryptor() {
    const Module = require('./native/fhe-api.js');
    return new Promise((resolve, reject) => {
        let initialized = false;
        Module.onRuntimeInitialized = () => {
            initialized = true;
            const encryptIntegerSafe = async (pk, input) => {
                const outLenPtr = Module._malloc(4);
                if (!outLenPtr)
                    throw new Error('malloc failed for outLenPtr');
                let ptr = 0;
                try {
                    ptr = Module.ccall('encrypt_integer_ex', 'number', ['number', 'array', 'number', 'array', 'number'], [outLenPtr, pk, pk.length, input, input.length]);
                    if (!ptr)
                        throw new Error('encrypt_integer_ex returned null');
                    const outLen = Module.HEAP32[outLenPtr >> 2];
                    if (outLen <= 0 || outLen > MAX_NATIVE_OUTPUT_SIZE) {
                        throw new Error(`invalid output length: ${outLen}`);
                    }
                    const view = Module.HEAPU8.subarray(ptr, ptr + outLen);
                    const result = Uint8Array.from(view);
                    return result;
                }
                finally {
                    if (ptr)
                        Module.ccall('free_data', null, ['number'], [ptr]);
                    Module._free(outLenPtr);
                }
            };
            resolve(encryptIntegerSafe);
        };
        setTimeout(() => {
            if (!initialized)
                reject(new Error('WASM module initialization timeout.'));
        }, 5000);
    });
}
let callAlgorithm = null;
const init = async () => {
    callAlgorithm = await loadWasmEncryptor();
};
exports.init = init;
const getCiphertext = async (pk, input) => {
    if (!callAlgorithm) {
        try {
            await (0, exports.init)();
        }
        catch (e) {
            console.error('[error] Algorithm initialization failed:', e);
            throw new Error('Algorithm backend initialization failed. Cannot encrypt.');
        }
    }
    if (!callAlgorithm) {
        throw new Error('Algorithm backend unavailable after initialization.');
    }
    try {
        return await callAlgorithm(pk, input);
    }
    catch (e) {
        console.error('[error] Encryption failed:', e);
        throw new Error('Encryption operation failed.');
    }
};
exports.getCiphertext = getCiphertext;
async function encryptInteger(pkFile, input) {
    const pk = fs_1.default.readFileSync(pkFile);
    const inputBuf = Buffer.from(input);
    return await (0, exports.getCiphertext)(pk, inputBuf);
}
//# sourceMappingURL=fhe_api.js.map