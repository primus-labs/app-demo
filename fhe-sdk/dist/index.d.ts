import { Wallet } from "ethers";
export declare const HANDLE_VERSION: number;
export declare const SERVER_PK_FILE: string;
export declare const MOCK_SERVER_PK_FILE: string;
export declare enum EncodingType {
    Hex = 1,
    Base64 = 2
}
export declare enum FheType {
    ve_bool = 0,
    ve_uint8 = 1,
    ve_uint16 = 2,
    ve_uint32 = 3,
    ve_uint64 = 4,
    ve_uint128 = 5,
    ve_uint256 = 6
}
export declare enum PayloadType {
    ATTESTATION = 0,
    PROOF = 1
}
export interface UnverifiedEncryptData {
    handle: Uint8Array;
    dataType: PayloadType;
    data: Uint8Array;
}
export declare function requestPk(pkFile?: string, options?: any): Promise<void>;
export declare function requestEncrypt(wallet: Wallet, aclContractAddress: string, value: number | bigint, fheType: FheType, attObj?: any, options?: any): Promise<UnverifiedEncryptData>;
export declare function requestDecrypt(wallet: Wallet, aclContractAddress: string, fheType: FheType, handle: string, options?: any): Promise<bigint>;
//# sourceMappingURL=index.d.ts.map