"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayloadType = exports.FheType = exports.EncodingType = exports.MOCK_SERVER_PK_FILE = exports.SERVER_PK_FILE = exports.HANDLE_VERSION = void 0;
exports.requestPk = requestPk;
exports.requestEncrypt = requestEncrypt;
exports.requestDecrypt = requestDecrypt;
const ethers_1 = require("ethers");
const chai_1 = require("chai");
const fhe_api_1 = require("./fhe_api");
const utils_1 = require("./utils");
const fs_1 = __importDefault(require("fs"));
const verbose = 0;
exports.HANDLE_VERSION = 0;
exports.SERVER_PK_FILE = "./server_pk.bin";
exports.MOCK_SERVER_PK_FILE = "./mock_server_pk.bin";
var EncodingType;
(function (EncodingType) {
    EncodingType[EncodingType["Hex"] = 1] = "Hex";
    EncodingType[EncodingType["Base64"] = 2] = "Base64";
})(EncodingType || (exports.EncodingType = EncodingType = {}));
var FheType;
(function (FheType) {
    FheType[FheType["ve_bool"] = 0] = "ve_bool";
    FheType[FheType["ve_uint8"] = 1] = "ve_uint8";
    FheType[FheType["ve_uint16"] = 2] = "ve_uint16";
    FheType[FheType["ve_uint32"] = 3] = "ve_uint32";
    FheType[FheType["ve_uint64"] = 4] = "ve_uint64";
    FheType[FheType["ve_uint128"] = 5] = "ve_uint128";
    FheType[FheType["ve_uint256"] = 6] = "ve_uint256";
})(FheType || (exports.FheType = FheType = {}));
function getTypeLength(fheType) {
    switch (fheType) {
        case FheType.ve_bool: return 1;
        case FheType.ve_uint8: return 1;
        case FheType.ve_uint16: return 2;
        case FheType.ve_uint32: return 4;
        case FheType.ve_uint64: return 8;
        case FheType.ve_uint128: return 16;
        case FheType.ve_uint256: return 32;
        default: return 1;
    }
}
var PayloadType;
(function (PayloadType) {
    PayloadType[PayloadType["ATTESTATION"] = 0] = "ATTESTATION";
    PayloadType[PayloadType["PROOF"] = 1] = "PROOF";
})(PayloadType || (exports.PayloadType = PayloadType = {}));
async function requestPk(pkFile = exports.SERVER_PK_FILE, options) {
    if (fs_1.default.existsSync(pkFile)) {
        return;
    }
    const encodingHex = EncodingType.Hex.toString(16).padStart(2, '0');
    let reqPayload = {
        encoding: "0x" + encodingHex
    };
    if (verbose > 1) {
        console.log("download payload:", reqPayload);
    }
    const response = await (0, utils_1.fetchDownloadRpc)(reqPayload, { ...options });
    if (verbose > 0) {
        console.log("download response:", response);
    }
    if (response.error) {
        throw response.error;
    }
    const handleBytes = Buffer.from((0, utils_1.fromHexString)(response.result.pk));
    fs_1.default.writeFileSync(pkFile, handleBytes);
}
async function requestEncrypt(wallet, aclContractAddress, value, fheType, attObj, options) {
    let pkFile = exports.MOCK_SERVER_PK_FILE;
    if (!(options && options.isMock)) {
        await requestPk(exports.SERVER_PK_FILE, options);
        pkFile = exports.SERVER_PK_FILE;
    }
    const _valueHex = value.toString(16).padStart(64, '0');
    const _valueBytes32 = Buffer.from(_valueHex, 'hex');
    if (verbose > 1) {
        console.log('value', value);
        console.log('_valueHex', _valueHex);
        console.log('_valueBytes32', _valueBytes32);
    }
    const typeLength = getTypeLength(fheType);
    const input = _valueBytes32.subarray(_valueBytes32.length - typeLength);
    if (verbose > 1) {
        console.log('input', input);
    }
    const valueBytes32 = (0, fhe_api_1.encryptInteger)(pkFile, input);
    const valueHex = Buffer.from(valueBytes32).toString("hex");
    if (verbose > 1) {
        console.log('valueHex', valueHex.slice(0, 32), "...", valueHex.slice(valueHex.length - 16));
        console.log('valueBytes32', valueBytes32);
    }
    const fheTypeHex = EncodingType.Hex.toString(16).padStart(2, '0');
    const fheTypeBytes1 = Buffer.from(fheTypeHex, 'hex');
    if (verbose > 1) {
        console.log('fheType', fheType);
        console.log('fheTypeHex', fheTypeHex);
        console.log('fheTypeBytes1', fheTypeBytes1);
    }
    const userAddress = wallet.address;
    const userAddressBytes20 = Buffer.from((0, utils_1.fromHexString)(userAddress));
    if (verbose > 1) {
        console.log('userAddress', userAddress);
        console.log('userAddressBytes20', userAddressBytes20);
    }
    const aclContractAddressBytes20 = Buffer.from((0, utils_1.fromHexString)(aclContractAddress));
    if (verbose > 1) {
        console.log('aclContractAddress', aclContractAddress);
        console.log('aclContractAddressBytes20', aclContractAddressBytes20);
    }
    let attBytesHex = "0xAA";
    if (attObj) {
        attBytesHex = (0, utils_1.encodeAttestation)(attObj);
    }
    const attBytes = ethers_1.ethers.getBytes(attBytesHex);
    const attBytesHash = ethers_1.ethers.keccak256(attBytes);
    const attBytesHashBytes = Buffer.from((0, utils_1.fromHexString)(attBytesHash));
    if (verbose > 1) {
        console.log('attBytesHash', attBytesHash);
        console.log('attBytesHashBytes', attBytesHashBytes);
    }
    const ts = Date.now();
    const tsHex = ts.toString(16).padStart(16, '0');
    const tsBytes8 = Buffer.from(tsHex, 'hex');
    if (verbose > 1) {
        console.log('ts', ts);
        console.log('tsHex', tsHex);
        console.log('tsBytes8', tsBytes8);
    }
    const messageBytes = ethers_1.ethers.concat([
        valueBytes32,
        fheTypeBytes1,
        userAddressBytes20,
        aclContractAddressBytes20,
        attBytesHashBytes,
        tsBytes8,
    ]);
    const digest = ethers_1.ethers.keccak256(messageBytes);
    const sig = wallet.signingKey.sign(digest);
    const signature = ethers_1.ethers.Signature.from(sig).serialized;
    if (verbose > 1) {
        console.log("digest:", digest);
        console.log("signature:", signature);
    }
    {
        const publicKey = ethers_1.ethers.SigningKey.recoverPublicKey(digest, signature);
        const recoveredAddress = ethers_1.ethers.computeAddress(publicKey);
        if (verbose > 1) {
            console.log("Recovered Address:", recoveredAddress);
        }
        (0, chai_1.expect)(recoveredAddress).to.eq(userAddress);
    }
    let handleBytes = ethers_1.ethers.getBytes(digest);
    for (let i = 20; i < 32; i++) {
        handleBytes[i] = 0;
    }
    handleBytes[30] = fheType;
    handleBytes[31] = exports.HANDLE_VERSION;
    const handleBytesHex = Buffer.from(handleBytes).toString("hex");
    if (verbose > 1) {
        console.log("handleBytesHex:", handleBytesHex);
    }
    const encodingHex = EncodingType.Hex.toString(16).padStart(2, '0');
    let reqPayload = {
        handle: "0x" + handleBytesHex,
        ciphertext: "0x" + valueHex,
        encoding: "0x" + encodingHex,
        userAddress: userAddress,
        aclContractAddress: aclContractAddress,
        attBytesHash: attBytesHash,
        signature: signature,
        timestamp: "0x" + tsHex,
    };
    if (verbose > 1) {
        console.log("encrypt payload:", reqPayload);
    }
    const response = await (0, utils_1.fetchEncryptRpc)(reqPayload, { ...options });
    if (verbose > 0) {
        console.log("encrypt response:", response);
    }
    if (response.error) {
        throw response.error;
    }
    let res = {
        handle: Buffer.from((0, utils_1.fromHexString)(response.result[0].handle)),
        dataType: PayloadType.ATTESTATION,
        data: attBytes,
    };
    return res;
}
async function _requestDecrypt(wallet, aclContractAddress, fheType, handle, options) {
    const handleBytes = Buffer.from((0, utils_1.fromHexString)(handle));
    const handleBytesHex = Buffer.from(handleBytes).toString("hex");
    if (verbose > 1) {
        console.log("handle:", handle);
        console.log("handleBytes:", handleBytes);
        console.log("handleBytesHex:", handleBytesHex);
    }
    const fheTypeHex = fheType.toString(16).padStart(2, '0');
    const fheTypeBytes1 = Buffer.from(fheTypeHex, 'hex');
    if (verbose > 1) {
        console.log('fheType', fheType);
        console.log('fheTypeHex', fheTypeHex);
        console.log('fheTypeBytes1', fheTypeBytes1);
    }
    const userAddress = wallet.address;
    const userAddressBytes20 = Buffer.from((0, utils_1.fromHexString)(userAddress));
    if (verbose > 1) {
        console.log('userAddress', userAddress);
        console.log('userAddressBytes20', userAddressBytes20);
    }
    const aclContractAddressBytes20 = Buffer.from((0, utils_1.fromHexString)(aclContractAddress));
    if (verbose > 1) {
        console.log('aclContractAddress', aclContractAddress);
        console.log('aclContractAddressBytes20', aclContractAddressBytes20);
    }
    const ts = Date.now();
    const tsHex = ts.toString(16).padStart(16, '0');
    const tsBytes8 = Buffer.from(tsHex, 'hex');
    if (verbose > 1) {
        console.log('ts', ts);
        console.log('tsHex', tsHex);
        console.log('tsBytes8', tsBytes8);
    }
    const messageBytes = ethers_1.ethers.concat([
        handleBytes,
        fheTypeBytes1,
        userAddressBytes20,
        aclContractAddressBytes20,
        tsBytes8,
    ]);
    const digest = ethers_1.ethers.keccak256(messageBytes);
    const sig = wallet.signingKey.sign(digest);
    const signature = ethers_1.ethers.Signature.from(sig).serialized;
    if (verbose > 1) {
        console.log("digest:", digest);
        console.log("signature:", signature);
    }
    {
        const publicKey = ethers_1.ethers.SigningKey.recoverPublicKey(digest, signature);
        const recoveredAddress = ethers_1.ethers.computeAddress(publicKey);
        if (verbose > 1) {
            console.log("Recovered Address:", recoveredAddress);
        }
        (0, chai_1.expect)(recoveredAddress).to.eq(userAddress);
    }
    let reqPayload = {
        handle: "0x" + handleBytesHex,
        valueType: "0x" + fheTypeHex,
        userAddress: userAddress,
        aclContractAddress: aclContractAddress,
        signature: signature,
        timestamp: "0x" + tsHex,
    };
    if (verbose > 1) {
        console.log("decrypt payload:", reqPayload);
    }
    const response = await (0, utils_1.fetchDecryptRpc)(reqPayload, { ...options });
    return response;
}
async function requestDecrypt(wallet, aclContractAddress, fheType, handle, options) {
    if ((0, utils_1.bytesToBigInt)((0, utils_1.fromHexString)(handle)) == 0n) {
        return 0n;
    }
    {
        const aclContract = (0, utils_1.getACLContract)(aclContractAddress, wallet);
        let tx = await aclContract.isAllowed(handle, wallet.address)
            || await aclContract['isAllowedForDecryption(bytes32,address)'](handle, wallet.address);
        console.warn(`${handle.slice(0, 8)}...${handle.slice(60)}`, "isAllowed for", `${wallet.address.slice(0, 8)}...${wallet.address.slice(36)}`, "(to decrypt) ?", tx);
    }
    const start = Date.now();
    const timeout = options?.timeout && options.timeout > 0 ? options.timeout : 30_000;
    const interval = options?.interval || 1000;
    const verbose = options?.verbose || 0;
    let counter = 0;
    while (true) {
        const elapsed = Date.now() - start;
        if (elapsed >= timeout && counter > 0) {
            throw new Error(`timeout after ${elapsed}ms`);
        }
        counter++;
        let response;
        try {
            response = await _requestDecrypt(wallet, aclContractAddress, fheType, handle, options);
        }
        catch (error) {
            console.warn("_requestDecrypt error:", error);
            await new Promise((resolve) => setTimeout(resolve, interval));
            continue;
        }
        if (response.error) {
            const { code, message } = response.error;
            if (code === 404) {
            }
            else {
                throw new Error(`${code}: ${message}`);
            }
        }
        else {
            if (verbose > 1) {
                console.log(counter, "decrypt response:", response);
            }
            if (response?.result?.length > 0 && response.result[0].value?.length > 2) {
                const res = (0, utils_1.bytesToBigInt)((0, utils_1.fromHexString)(response.result[0].value));
                console.log(`decrypt success after ${elapsed} ms. res:`, res);
                return res;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return 0n;
}
//# sourceMappingURL=index.js.map