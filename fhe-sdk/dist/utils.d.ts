import { ethers as EthersT } from "ethers";
import 'dotenv/config';
export declare function getACLContract(address: string, signer?: any): EthersT.Contract;
export declare const fromHexString: (hexString: string) => Uint8Array;
export declare const bytesToHex: (byteArray: Uint8Array) => `0x${string}`;
export declare const bytesToBigInt: (byteArray: Uint8Array) => bigint;
export declare function encodeAttestation(att: any): string;
export type Operation = 'DOWNLOAD_PK' | 'UPLOAD_CIPHER' | 'USER_DECRYPT';
export declare function getServerPkFileName(): string;
export declare function fetchJsonRpc(operation: Operation, url: string, payload: any, options?: any): Promise<any>;
export declare function fetchDownloadRpc(payload: any, options?: any): Promise<any>;
export declare function fetchEncryptRpc(payload: any, options?: any): Promise<any>;
export declare function fetchDecryptRpc(payload: any, options?: any): Promise<any>;
//# sourceMappingURL=utils.d.ts.map