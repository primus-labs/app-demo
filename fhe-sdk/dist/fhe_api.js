"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCiphertext = exports.init = void 0;
exports.encryptInteger = encryptInteger;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const platform_1 = require("./platform");
const ffi_napi_1 = __importDefault(require("ffi-napi"));
const ref_napi_1 = __importDefault(require("ref-napi"));
const Int = ref_napi_1.default.types.int;
const IntPtr = ref_napi_1.default.refType(Int);
const UInt8 = ref_napi_1.default.types.uint8;
const UInt8Ptr = ref_napi_1.default.refType(UInt8);
const CString = ref_napi_1.default.types.CString;
const MAX_NATIVE_OUTPUT_SIZE = 100_000_000;
function loadNativeEncryptor() {
    const libPath = path_1.default.resolve(__dirname, "./native/libfhe-api.so");
    if (!fs_1.default.existsSync(libPath)) {
        throw new Error(`Native library not found at ${libPath}`);
    }
    const libfhe = ffi_napi_1.default.Library(libPath, {
        encrypt_integer: [UInt8Ptr, [IntPtr, CString, UInt8Ptr, Int]],
        encrypt_integer_ex: [UInt8Ptr, [IntPtr, CString, Int, UInt8Ptr, Int]],
        free_data: ["void", [UInt8Ptr]],
    });
    return async (pk, input) => {
        const outLenPtr = ref_napi_1.default.alloc(Int);
        const inputBuf = Buffer.from(input);
        const ptr = libfhe.encrypt_integer_ex(outLenPtr, pk, pk.length, inputBuf, input.length);
        if (ptr.isNull())
            throw new Error("encrypt_integer_ex returned NULL");
        const outLen = outLenPtr.deref();
        if (outLen <= 0 || outLen > MAX_NATIVE_OUTPUT_SIZE) {
            libfhe.free_data(ptr);
            throw new Error(`Invalid output length from native call: ${outLen}`);
        }
        const result = Buffer.from(ptr.reinterpret(outLen, 0));
        libfhe.free_data(ptr);
        return new Uint8Array(result);
    };
}
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
async function initAlgorithm(mode = "auto") {
    if (mode === "native") {
        console.log("[info] trying native backend...");
        return loadNativeEncryptor();
    }
    if (mode === "wasm") {
        console.log("[info] trying wasm backend...");
        return await loadWasmEncryptor();
    }
    try {
        console.log("[info] trying native backend first...");
        return loadNativeEncryptor();
    }
    catch (err) {
        console.log("[warn] trying wasm backend, because native backend failed:", err);
        return await loadWasmEncryptor();
    }
}
let callAlgorithm = null;
const init = async (mode = 'auto') => {
    callAlgorithm = await initAlgorithm(mode);
};
exports.init = init;
const getCiphertext = async (pk, input) => {
    if (!callAlgorithm) {
        try {
            if ((0, platform_1.isUbuntu)()) {
                await (0, exports.init)();
            }
            else {
                await (0, exports.init)('wasm');
            }
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