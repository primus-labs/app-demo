"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptInteger = encryptInteger;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ffi_napi_1 = __importDefault(require("ffi-napi"));
const ref_napi_1 = __importDefault(require("ref-napi"));
const Int = ref_napi_1.default.types.int;
const IntPtr = ref_napi_1.default.refType(Int);
const UInt8 = ref_napi_1.default.types.uint8;
const UInt8Ptr = ref_napi_1.default.refType(UInt8);
const CString = ref_napi_1.default.types.CString;
const libPath = path_1.default.resolve(__dirname, "./native/libfhe-api.so");
const libfhe = ffi_napi_1.default.Library(libPath, {
    encrypt_integer: [UInt8Ptr, [IntPtr, CString, UInt8Ptr, Int]],
    encrypt_integer_ex: [UInt8Ptr, [IntPtr, CString, Int, UInt8Ptr, Int]],
    free_data: ["void", [UInt8Ptr]]
});
function encryptInteger(pkFile, input) {
    const outLen = ref_napi_1.default.alloc(Int);
    const inputBuf = Buffer.from(input);
    const pk = fs_1.default.readFileSync(pkFile);
    const ptr = libfhe.encrypt_integer_ex(outLen, pk, pk.length, inputBuf, input.length);
    if (ptr.isNull())
        throw new Error("encrypt_integer returned NULL");
    const out_len = outLen.deref();
    const result = Buffer.from(ptr.reinterpret(out_len, 0));
    libfhe.free_data(ptr);
    const res = new Uint8Array(result);
    return res;
}
//# sourceMappingURL=fhe_api.js.map