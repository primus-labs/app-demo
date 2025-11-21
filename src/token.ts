import { ethers as EthersT, Wallet } from "ethers";
import { PrivyTokenU64V2_1_ABI } from "./abis/PrivyTokenU64V2_1_ABI";
import { MyOZERC20_ABI } from "./abis/MyOZERC20_ABI";
import { PUSDCTokenV2_1_ABI } from "./abis/PUSDCTokenV2_1_ABI";
import { PMUSDTokenV2_1_ABI } from "./abis/PMUSDTokenV2_1_ABI";
import { requestEncrypt, requestDecrypt, FheType } from "nc97-fhe-sdk";
import { getACLContract as _getACLContract } from "nc97-fhe-sdk/dist/utils";
import 'dotenv/config';


export class Erc20Token {
  protected verbose: number = 0;
  protected readonly isMock = process.env.MOCK_TEST === "ON";

  readonly provider: EthersT.JsonRpcProvider;
  readonly signer: Wallet | null;
  private chainId: number | null = null;

  protected tokenAddress: string;
  protected tokenContract: EthersT.Contract;

  private decimalsCache: number | null = null;

  constructor(tokenAddress: string, tokenABI: EthersT.Interface | EthersT.InterfaceAbi) {
    const RPC_URL = process.env.RPC_URL || "";
    const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
    this.provider = new EthersT.JsonRpcProvider(RPC_URL);
    this.signer = PRIVATE_KEY ? new EthersT.Wallet(PRIVATE_KEY, this.provider) : null;
    this.tokenContract = new EthersT.Contract(tokenAddress, tokenABI, this.signer ?? this.provider);
    this.tokenAddress = tokenAddress;
  }

  async getChainID(): Promise<number> {
    if (!this.chainId) {
      this.chainId = Number((await this.provider.getNetwork()).chainId);
    }
    return this.chainId;
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
    return await this.tokenContract.mint(owner, amount);
  }
  protected async _burn(owner: string, amount: any): Promise<any> {
    return await this.tokenContract.burn(owner, amount);
  }
  async mint(owner: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    console.log("Mint amountHandle:", this.formatHandle(amountHandle));
    const tx = await this._mint(owner, amountHandle);
    console.log("Mint tx:", tx.hash);
    await tx.wait();
    console.log("Mint Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async burn(owner: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    console.log("Burn amountHandle:", this.formatHandle(amountHandle));
    const tx = await this._burn(owner, amountHandle);
    console.log("Burn tx:", tx.hash);
    await tx.wait();
    console.log("Burn Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async transfer(to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    console.log("Transfer amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.transfer(to, amountHandle);
    console.log("Transfer tx:", tx.hash);
    await tx.wait();
    console.log("Transfer Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async approve(spender: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    console.log("Approve amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.approve(spender, amountHandle);
    console.log("Approve tx:", tx.hash);
    await tx.wait();
    console.log("Approve Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async transferFrom(from: string, to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = await this.encrypt(EthersT.parseUnits(amount, decimals));
    console.log("TransferFrom amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.transferFrom(from, to, amountHandle);
    console.log("TransferFrom tx:", tx.hash);
    await tx.wait();
    console.log("TransferFrom Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }
}

export class MyOZERC20Token extends Erc20Token {
  constructor() {
    const OZERC20_TOKEN_ADDRESS = process.env.OZERC20_TOKEN_ADDRESS || "";
    super(OZERC20_TOKEN_ADDRESS, MyOZERC20_ABI);
  }
}


export class EncryptedErc20Token extends Erc20Token {
  private readonly ACL_ADDRESS = process.env.ACL_ADDRESS || "";
  protected aclContract: EthersT.Contract;

  constructor(tokenAddress: string, tokenABI: EthersT.Interface | EthersT.InterfaceAbi) {
    super(tokenAddress, tokenABI);
    this.aclContract = _getACLContract(this.ACL_ADDRESS, this.signer ?? this.provider);
  }

  protected getFheType(): FheType {
    return FheType.ve_uint256;
  }

  protected async encrypt(value: number | bigint, timeout: number = 30000): Promise<any> {
    return await requestEncrypt(
      this.signer as Wallet,
      this.ACL_ADDRESS,
      value,
      this.getFheType(),
      await this.getChainID(),
      null,
      { isMock: this.isMock }
    );
  }

  protected async decrypt(handle: string, timeout: number = 30000): Promise<any> {
    return await requestDecrypt(
      this.signer as Wallet,
      this.ACL_ADDRESS,
      this.getFheType(),
      handle,
      { isMock: this.isMock, timeout: timeout }
    );
  }

  async allowForDecryption(handle: string, account?: string) {
    let tx;
    if (account) {
      tx = await this.aclContract['accessPolicy(bytes32,address,uint8)'](handle, account, 2);
    } else {
      tx = await this.aclContract.allowForDecryption([handle]);
    }
    console.log("allowForDecryption tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");

    return { txHash: tx.hash };
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
    return await this.tokenContract.mint(amount);
  }
  protected async _burn(_: string, amount: any): Promise<any> {
    return await this.tokenContract.burn(amount);
  }
}

export class PUSDCTokenV2_1 extends PrivyTokenWithWhiteList {
  constructor() {
    const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
    super(PUSDC_TOKEN_ADDRESS, PUSDCTokenV2_1_ABI);
  }
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
    const tx = await this.tokenContract.deposit(amountHandle);
    console.log("Deposit tx:", tx.hash);
    await tx.wait();
    console.log("Deposit Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async claim(to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = EthersT.parseUnits(amount, decimals);
    console.log("Claim amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.claim(to, amountHandle);
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

export class PMUSDTokenV2_1 extends PrivyTokenWithWhiteList {
  constructor() {
    const PMUSD_TOKEN_ADDRESS = process.env.PMUSD_TOKEN_ADDRESS || "";
    super(PMUSD_TOKEN_ADDRESS, PMUSDTokenV2_1_ABI);
  }
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
    const tx = await this.tokenContract.deposit(amountHandle);
    console.log("Deposit tx:", tx.hash);
    await tx.wait();
    console.log("Deposit Confirmed");
    return { amountHandle: this.formatHandle(amountHandle), txHash: tx.hash };
  }

  async claim(to: string, amount: string) {
    const decimals = await this.decimals();
    const amountHandle = EthersT.parseUnits(amount, decimals);
    console.log("Claim amountHandle:", this.formatHandle(amountHandle));
    const tx = await this.tokenContract.claim(to, amountHandle);
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

