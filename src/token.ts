import { ethers as EthersT, Wallet } from "ethers";
import { PrivyTokenU64V2_1_ABI } from "./abis/PrivyTokenU64V2_1_ABI";
import { OZERC20_ABI } from "./abis/OZERC20_ABI";
import { PUSDCTokenV2_1_ABI } from "./abis/PUSDCTokenV2_1_ABI";
import { PUSDCTokenU64V2_1_ABI } from "./abis/PUSDCTokenU64V2_1_ABI";
import { PMUSDTokenV2_1_ABI } from "./abis/PMUSDTokenV2_1_ABI";
import { FheSDK, FheType } from "primus-fhe-sdk";
import abiACL from "primus-fhe-sdk/dist/abi/ACL.json"
import abiFHEExecutor from "primus-fhe-sdk/dist/abi/FHEExecutor.json"
import abiCiphertextVerification from "primus-fhe-sdk/dist/abi/CiphertextVerification.json"
import { ErrorParser } from "./utils";
import 'dotenv/config';
// Extract ABIs from JSON imports
const { abi: aclABI } = abiACL;
const { abi: fheExecutorABI } = abiFHEExecutor;
const { abi: ciphertextVerificationABI } = abiCiphertextVerification;

export class Erc20Token {
  showHandle: boolean = true;
  feeValue: bigint = 0n;

  protected verbose: number = 0;
  protected readonly isMock = process.env.MOCK_TEST === "ON";

  readonly provider: EthersT.JsonRpcProvider;
  readonly signer: Wallet | null;
  private chainId: number | null = null;

  protected tokenAddress: string;
  protected tokenContract: EthersT.Contract;
  protected errorParser: ErrorParser;

  private decimalsCache: number | null = null;

  constructor(tokenAddress: string, tokenABI: EthersT.Interface | EthersT.InterfaceAbi) {
    const RPC_URL = process.env.RPC_URL || "";
    const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
    this.provider = new EthersT.JsonRpcProvider(RPC_URL);
    this.signer = PRIVATE_KEY ? new EthersT.Wallet(PRIVATE_KEY, this.provider) : null;
    this.tokenAddress = tokenAddress;
    this.tokenContract = new EthersT.Contract(tokenAddress, tokenABI, this.signer ?? this.provider);
    this.errorParser = new ErrorParser().addAbi(tokenABI);
  }

  async getChainID(): Promise<number> {
    if (!this.chainId) {
      this.chainId = Number((await this.provider.getNetwork()).chainId);
    }
    return this.chainId;
  }

  txOptions(options: any = {}) {
    if (this.feeValue > 0n) return { value: this.feeValue };
    if (options?.feeValue) return { value: options.feeValue };
    return {};
  }
  protected async getFheFee(functionName: string) {
    return 0n;
  }

  // ========== Hooks for Encrypted Version ==========
  protected async encrypt(value: number | bigint, timeout: number = 30000): Promise<any> {
    return value;
  }
  protected async decrypt(handle: string, timeout: number = 30000): Promise<any> {
    return handle;
  }
  protected formatHandle(uve: any): any {
    if (typeof uve === "string") return uve;
    if (uve && uve.handle) {
      if (typeof uve.handle === "string") return uve.handle.startsWith("0x") ? uve.handle : `0x${uve.handle}`;
      return "0x" + Buffer.from(uve.handle).toString("hex");
    }
    return String(uve);
  }

  // ========== Query APIs ==========
  async name() {
    return await this.tokenContract.name();
  }
  async symbol() {
    return await this.tokenContract.symbol();
  }
  async decimals(): Promise<number> {
    if (this.decimalsCache) return this.decimalsCache;
    this.decimalsCache = await this.tokenContract.decimals();
    return this.decimalsCache as number;
  }

  async totalSupply() {
    const totalSupplyHandle = await this.tokenContract.totalSupply();
    const totalSupply = await this.decrypt(totalSupplyHandle);
    const decimals = await this.decimals();
    const formattedtotalSupply = EthersT.formatUnits(totalSupply, decimals);
    return { totalSupplyHandle, totalSupply, formattedtotalSupply };
  }

  async balanceOf(account: string) {
    const balanceHandle = await this.tokenContract.balanceOf(account);
    console.log('balanceHandle', balanceHandle)
    const balance = await this.decrypt(balanceHandle);
    const decimals = await this.decimals();
    const formattedBalance = EthersT.formatUnits(balance, decimals);
    return { balanceHandle, balance, formattedBalance };
  }

  async allowance(owner: string, spender: string) {
    const allowanceHandle = await this.tokenContract.allowance(owner, spender);
    const allowance = await this.decrypt(allowanceHandle);
    const decimals = await this.decimals();
    const formattedAllowance = EthersT.formatUnits(allowance, decimals);
    return { allowanceHandle, allowance, formattedAllowance };
  }

  // ========== State-changing APIs ==========
  protected async _mint(owner: string, amount: any): Promise<any> {
    return await this.tokenContract.mint(owner, amount, this.txOptions());
  }
  protected async _burn(owner: string, amount: any): Promise<any> {
    return await this.tokenContract.burn(owner, amount, this.txOptions());
  }
  async mint(owner: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    if (this.showHandle) console.log("Mint amountHandle:", this.formatHandle(amountHandle));
    const tx = await this._mint(owner, amountHandle);
    console.log("Mint tx:", tx.hash);
    await tx.wait();
    console.log("Mint Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async burn(owner: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    if (this.showHandle) console.log("Burn amountHandle:", this.formatHandle(amountHandle));
    const tx = await this._burn(owner, amountHandle);
    console.log("Burn tx:", tx.hash);
    await tx.wait();
    console.log("Burn Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async transfer(to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    if (this.showHandle) console.log("Transfer amountHandle:", this.formatHandle(amountHandle));
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("transfer") });
    {
      const gasEstimate = await this.tokenContract.transfer.estimateGas(to, amountHandle, txOpt).catch(this.errorParser.catch);
      console.log("Transfer Gas estimate:", gasEstimate.toString());
    }
    const tx = await this.tokenContract.transfer(to, amountHandle, txOpt).catch(this.errorParser.catch);
    console.log("Transfer tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transfer Confirmed. Gas used: " + receipt.gasUsed.toString());
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async approve(spender: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    if (this.showHandle) console.log("Approve amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.approve(spender, amountHandle);
    console.log("Approve tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("Approve Confirmed. Gas used: " + receipt.gasUsed.toString());
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async transferFrom(from: string, to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    if (this.showHandle) console.log("TransferFrom amountHandle:", this.formatHandle(amountHandle));
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("transferFrom") });
    {
      const gasEstimate = await this.tokenContract.transferFrom.estimateGas(from, to, amountHandle, txOpt).catch(this.errorParser.catch);
      console.log("TransferFrom Gas estimate:", gasEstimate.toString());
    }
    const tx = await this.tokenContract.transferFrom(from, to, amountHandle, txOpt).catch(this.errorParser.catch);
    console.log("TransferFrom tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("TransferFrom Confirmed. Gas used: " + receipt.gasUsed.toString());
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }
}

export class OZERC20Token extends Erc20Token {
  showHandle: boolean = false;
  constructor() {
    const OZERC20_TOKEN_ADDRESS = process.env.OZERC20_TOKEN_ADDRESS || "";
    super(OZERC20_TOKEN_ADDRESS, OZERC20_ABI);
  }
}

export class EncryptedErc20Token extends Erc20Token {
  protected fheSDK: FheSDK;

  constructor(tokenAddress: string, tokenABI: EthersT.Interface | EthersT.InterfaceAbi) {
    super(tokenAddress, tokenABI);
    this.errorParser.addAbi(aclABI).addAbi(fheExecutorABI).addAbi(ciphertextVerificationABI);
    this.fheSDK = new FheSDK({
      systemInfo: { decryptionUrl: process.env.DECRYPTION_RPC_URL || undefined }
    });
  }

  protected getFheType(): FheType {
    return FheType.ve_uint256;
  }

  protected async getFheFee(functionName: string) {
    const { totalFee } = await this.fheSDK.estimateFheFee(this.tokenAddress, functionName);
    return totalFee;
  }

  protected async encrypt(value: number | bigint, timeout: number = 30000): Promise<any> {
    return await this.fheSDK.encryptAndVerifyProof(this.tokenAddress as `0x${string}`, value, this.getFheType());
  }

  protected async decrypt(handle: string, timeout: number = 60000): Promise<any> {
    const res = await this.fheSDK.requestDecryption(handle);
    return res.value;
  }

  async allowForDecryption(handle: string, account?: string) {
    return this.fheSDK.allowForDecryption(handle, account).catch(this.errorParser.catch);
  }

  async userDecrypt(handle: string): Promise<any> {
    return await this.decrypt(handle);
  }
}


export class PrivyTokenWithWhiteList extends EncryptedErc20Token {
  async transferOwnership(to: string) {
    const tx = await this.tokenContract.transferOwnership(to);
    console.log("transferOwnership tx:", tx.hash);
    await tx.wait();
    console.log("transferOwnership Confirmed");
    return { to: to, txHash: tx.hash };
  }

  async addToWhitelist(account: string) {
    const tx = await this.tokenContract.addToWhitelist(account);
    console.log("addToWhitelist tx:", tx.hash);
    await tx.wait();
    console.log("addToWhitelist Confirmed");
    return { account: account, txHash: tx.hash };
  }

  async removeFromWhitelist(account: string) {
    const tx = await this.tokenContract.removeFromWhitelist(account);
    console.log("removeFromWhitelist tx:", tx.hash);
    await tx.wait();
    console.log("removeFromWhitelist Confirmed");
    return { account: account, txHash: tx.hash };
  }

  async isWhitelisted(account: string) {
    const isWhitelisted = await this.tokenContract.isWhitelisted(account);
    return { isWhitelisted };
  }

  async getFullWhitelist() {
    const fullWhitelist = await this.tokenContract.getFullWhitelist();
    return { fullWhitelist };
  }

  async getTotalHandles() {
    const totalHandles = await this.tokenContract.getTotalHandles();
    return { totalHandles };
  }
}

export class PrivyTokenU64V2_1 extends PrivyTokenWithWhiteList {
  constructor() {
    const PRIVY_TOKEN_ADDRESS = process.env.PRIVY_TOKEN_ADDRESS || "";
    super(PRIVY_TOKEN_ADDRESS, PrivyTokenU64V2_1_ABI);
  }

  protected getFheType(): FheType {
    return FheType.ve_uint64;
  }
  protected async _mint(_: string, amount: any): Promise<any> {
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("mint") });
    return await this.tokenContract.mint(amount, txOpt);
  }
  protected async _burn(_: string, amount: any): Promise<any> {
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("burn") });
    return await this.tokenContract.burn(amount, txOpt);
  }
}

export class PrivyTokenWithWhiteListAndDeposit extends PrivyTokenWithWhiteList {
  protected getFheType(): FheType {
    return FheType.ve_uint256;
  }

  async mint(owner: string, amount: any): Promise<any> {
    console.error("not supported");
  }
  async burn(owner: string, amount: any): Promise<any> {
    console.error("not supported");
  }

  async deposit(amount: string) {
    const decimals = await this.decimals();
    const amountHandle = EthersT.parseUnits(amount, decimals);
    console.log("Deposit amountHandle:", this.formatHandle(amountHandle));
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("deposit") });
    {
      const gasEstimate = await this.tokenContract.deposit.estimateGas(amountHandle, txOpt).catch(this.errorParser.catch);
      console.log("Deposit Gas estimate:", gasEstimate.toString());
    }
    const tx = await this.tokenContract.deposit(amountHandle, txOpt).catch(this.errorParser.catch);
    console.log("Deposit tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("Deposit Confirmed. Gas used:" + receipt.gasUsed.toString());
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async claim(to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = EthersT.parseUnits(amount, decimals);
    console.log("Claim amountHandle:", this.formatHandle(amountHandle));
    const txOpt = this.txOptions({ feeValue: await this.getFheFee("claim") });
    {
      const gasEstimate = await this.tokenContract.claim.estimateGas(to, amountHandle, txOpt).catch(this.errorParser.catch);
      console.log("Claim Gas estimate:", gasEstimate.toString());
    }
    const tx = await this.tokenContract.claim(to, amountHandle, txOpt).catch(this.errorParser.catch);
    console.log("Claim tx:", tx.hash);
    await tx.wait();
    console.log("Claim Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async addOracle(oracle: string) {
    const tx = await this.tokenContract.addOracle(oracle);
    console.log("addOracle tx:", tx.hash);
    await tx.wait();
    console.log("addOracle Confirmed");
    return { oracle: oracle, txHash: tx.hash };
  }

  async removeOracle(oracle: string) {
    const tx = await this.tokenContract.removeOracle(oracle);
    console.log("removeOracle tx:", tx.hash);
    await tx.wait();
    console.log("removeOracle Confirmed");
    return { oracle: oracle, txHash: tx.hash };
  }
}

export class PUSDCTokenV2_1 extends PrivyTokenWithWhiteListAndDeposit {
  constructor() {
    const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
    super(PUSDC_TOKEN_ADDRESS, PUSDCTokenV2_1_ABI);
  }
}
export class PUSDCTokenU64V2_1 extends PrivyTokenWithWhiteListAndDeposit {
  protected getFheType(): FheType {
    return FheType.ve_uint64;
  }
  constructor() {
    const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
    super(PUSDC_TOKEN_ADDRESS, PUSDCTokenU64V2_1_ABI);
  }
}

export class PMUSDTokenV2_1 extends PrivyTokenWithWhiteListAndDeposit {
  constructor() {
    const PMUSD_TOKEN_ADDRESS = process.env.PMUSD_TOKEN_ADDRESS || "";
    super(PMUSD_TOKEN_ADDRESS, PMUSDTokenV2_1_ABI);
  }
}

