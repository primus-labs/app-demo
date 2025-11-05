"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bytesToBigInt = exports.bytesToHex = exports.fromHexString = void 0;
exports.getACLContract = getACLContract;
exports.encodeAttestation = encodeAttestation;
exports.getServerPkFileName = getServerPkFileName;
exports.fetchJsonRpc = fetchJsonRpc;
exports.fetchDownloadRpc = fetchDownloadRpc;
exports.fetchEncryptRpc = fetchEncryptRpc;
exports.fetchDecryptRpc = fetchDecryptRpc;
const crypto_1 = require("crypto");
const ethers_1 = require("ethers");
require("dotenv/config");
const ACL_json_1 = __importDefault(require("./abi/ACL.json"));
const { abi: aclABI } = ACL_json_1.default;
function getACLContract(address, signer) {
    return new ethers_1.ethers.Contract(address, aclABI, signer);
}
const fromHexString = (hexString) => {
    const arr = hexString.replace(/^(0x)/, '').match(/.{1,2}/g);
    if (!arr)
        return new Uint8Array();
    return Uint8Array.from(arr.map((byte) => parseInt(byte, 16)));
};
exports.fromHexString = fromHexString;
const bytesToHex = function (byteArray) {
    if (!byteArray || byteArray?.length === 0) {
        return '0x0';
    }
    const buffer = Buffer.from(byteArray);
    return `0x${buffer.toString('hex')}`;
};
exports.bytesToHex = bytesToHex;
const bytesToBigInt = function (byteArray) {
    if (!byteArray || byteArray?.length === 0) {
        return BigInt(0);
    }
    const hex = Array.from(byteArray)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return BigInt(`0x${hex}`);
};
exports.bytesToBigInt = bytesToBigInt;
const ATTESTATION_TYPE = `tuple(
    address,
    tuple(string,string,string,string),
    tuple(string,string,string)[],
    string,
    string,
    uint64,
    string,
    tuple(address,string)[],
    bytes[]
)`;
function encodeAttestation(att) {
    const abiCoder = new ethers_1.ethers.AbiCoder();
    const tupleValue = [
        att.recipient,
        [
            att.request.url,
            att.request.header,
            att.request.method,
            att.request.body
        ],
        att.responseResolve.map((r) => [r.keyName, r.parseType, r.parsePath]),
        att.data,
        att.attConditions,
        BigInt(att.timestamp),
        att.additionParams,
        att.attestors.map((a) => [a.attestorAddr, a.url]),
        att.signatures
    ];
    return abiCoder.encode([ATTESTATION_TYPE], [tupleValue]);
}
const ALPHA_TRION_RPC_URL = process.env.ALPHA_TRION_RPC_URL || "";
function getServerPkFileName() {
    if (ALPHA_TRION_RPC_URL === "") {
        throw new Error(`Missing ALPHA_TRION_RPC_URL in .env`);
    }
    const safeName = ALPHA_TRION_RPC_URL.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const filename = `server_pk-${safeName}.bin`;
    return filename;
}
async function fetchJsonRpc(operation, url, payload, options) {
    const init = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...options
        },
        body: JSON.stringify(payload),
    };
    let lastError;
    const delay = 1000;
    const retries = 3;
    let json;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, init);
            if (!response.ok) {
                throw "fetch init error";
            }
            const jsonResponse = await response.json();
            json = jsonResponse;
            return json;
        }
        catch (e) {
            lastError = `fetchJsonRpc Error: ${operation} with ${e}`;
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
                console.warn("i:", i + 1, "op:", operation, "fetch:", url, "with", init, "error", e);
            }
        }
    }
    throw lastError;
}
async function fetchDownloadRpc(payload, options) {
    if (options?.isMock) {
        const response = {
            jsonrpc: '2.0',
            id: 1234,
            result: {
                pk: "0x12345678",
            }
        };
        return response;
    }
    const request = {
        id: (0, crypto_1.randomInt)(0x7fffffff),
        params: [payload],
        method: "download",
        jsonrpc: "2.0"
    };
    const response = await fetchJsonRpc('DOWNLOAD_PK', ALPHA_TRION_RPC_URL, request, options);
    return response;
}
async function fetchEncryptRpc(payload, options) {
    if (options?.isMock) {
        const ciphertextHash = ethers_1.ethers.keccak256(ethers_1.ethers.getBytes(payload.signature));
        let ciphertextHashBytes = ethers_1.ethers.getBytes(ciphertextHash);
        const handleBytes = Buffer.from((0, exports.fromHexString)(payload.handle));
        const messageBytes = ethers_1.ethers.concat([
            ciphertextHashBytes,
            handleBytes,
        ]);
        const digest = ethers_1.ethers.keccak256(messageBytes);
        let digestBytes = ethers_1.ethers.getBytes(digest);
        for (let i = 0; i < 20; i++) {
            handleBytes[i] = digestBytes[i];
        }
        const handleBytesHex = Buffer.from(handleBytes).toString("hex");
        const response = {
            jsonrpc: '2.0',
            id: 1234,
            result: [{
                    handle: "0x" + handleBytesHex,
                }]
        };
        return response;
    }
    const request = {
        id: (0, crypto_1.randomInt)(0x7fffffff),
        params: [[payload]],
        method: "upload",
        jsonrpc: "2.0"
    };
    const response = await fetchJsonRpc('UPLOAD_CIPHER', ALPHA_TRION_RPC_URL, request, options);
    return response;
}
async function fetchDecryptRpc(payload, options) {
    if (options?.isMock) {
        const response = {
            jsonrpc: '2.0',
            id: 1234,
            result: [{
                    value: "0x0000000000000000000000000000000000000000000000000000000000000000",
                }]
        };
        return response;
    }
    const request = {
        id: (0, crypto_1.randomInt)(0x7fffffff),
        params: [[payload]],
        method: "decrypt",
        jsonrpc: "2.0"
    };
    const response = await fetchJsonRpc('USER_DECRYPT', ALPHA_TRION_RPC_URL, request, options);
    return response;
}
//# sourceMappingURL=utils.js.map