

- [Overview](#overview)
- [Configuration](#configuration)
- [Commandline tool](#commandline-tool)
  - [Fist-of-All](#fist-of-all)
    - [bindNativeToExecutor](#bindnativetoexecutor)
    - [releaseNativeFromExecutor](#releasenativefromexecutor)
    - [balanceOfNative](#balanceofnative)
  - [ERC20](#erc20)
    - [name](#name)
    - [symbol](#symbol)
    - [decimals](#decimals)
    - [totalSupply](#totalsupply)
    - [balance](#balance)
    - [allowance](#allowance)
    - [mint](#mint)
    - [burn](#burn)
    - [transfer](#transfer)
    - [approve](#approve)
    - [transferFrom](#transferfrom)
  - [Whitelist](#whitelist)
    - [transferOwnership](#transferownership)
    - [addToWhitelist](#addtowhitelist)
    - [removeFromWhitelist](#removefromwhitelist)
    - [isWhitelisted](#iswhitelisted)
    - [getFullWhitelist](#getfullwhitelist)
    - [getTotalHandles](#gettotalhandles)
  - [Decryption](#decryption)
    - [allowForDecryption](#allowfordecryption)
    - [userDecrypt](#userdecrypt)


## Overview

**Addresses:**

| Contract          | Address                                    | Chain(ID)           |
| ----------------- | ------------------------------------------ | ------------------- |
| PrivyToken(PRIVY) | 0x994eDfc783E0D42489Ae5fAd9DD90B253e97a191 | Base Sepolia(84532) |


<br/>

**PrivyToken(PRIVY)** is an **FHE-based** token built on the standard ERC20 contract. It supports typical ERC20 functionality such as transferring tokens, minting. Additionally, it supports whitelisting for regulatory purposes.


## Configuration

- Copy `.env.sepolia.base` to `.env`.
- Set up your wallet's private key `PRIVATE_KEY`.


## Commandline tool


**This tool consists of three components:**

* ERC20 basic functionality operations
* Whitelist-related operations
* Decryption operations


<br/>


Before using this tool, execute the following command:

```sh
npm install
npm run build
```

**Requirements:**
- node v22+

<br/>


**List all commands**

```sh
npx tsx src/privy-cli.ts help
```

```log
Usage: privy-cli [options] [command]

Options:
  -h, --help                           display help for command

Commands:
  name                                 Returns the name of the token.
  symbol                               Returns the symbol of the token, a shorter version of the name.
  decimals                             Returns the number of decimals used to get its user representation.
  totalSupply                          Returns the value of tokens in existence.
  balanceOf [options]                  Returns the value of tokens owned by `account`.
  allowance [options]                  Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner` through
                                       {transferFrom}.
  mint [options]                       Creates a value `amount` of tokens and assigns them to msg.sender, by transferring it from address(0).
  burn [options]                       Destroys a value `amount` of tokens from msg.sender, lowering the balance of msg.sender and the total supply.
  transfer [options]                   Moves a value `amount` of tokens from the caller's account to `to`.
  approve [options]                    Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.
  transferFrom [options]               Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism. `value` is then deducted from
                                       the caller's allowance.
  allowForDecryption [options]         Grants decryption permission for the `handle` to the specified `account`. If no `account` is provided, the `handle`
                                       will be decryptable by anyone.
  userDecrypt [options]                Retrieves the plaintext corresponding to the `handle`.
  bindNativeToExecutor [options]       Bind `amount` native token to FHEExecutor (only owner).
  releaseNativeFromExecutor [options]  Release `amount` native token from FHEExecutor (only owner).
  balanceOfNative                      Returns the value of tokens owned by `deployer` of FHEExecutor (only owner).
  transferOwnership [options]          Transfers the contract ownership to `to`.
  addToWhitelist [options]             Adds an `account` to the whitelist.
  removeFromWhitelist [options]        Removes an `account` from the whitelist.
  isWhitelisted [options]              Determines whether the `account` is on the whitelist.
  getFullWhitelist                     Retrieves the whitelist.
  getTotalHandles                      Retrieves all handles for contract status variables, including historical values.
  help [command]                       display help for command
```

### Fist-of-All

**Prerequisite**: If you are the contract deployer, you must run `bindNativeToExecutor` before (others) executing any other CLI commands.

#### bindNativeToExecutor

```sh
npx tsx src/privy-cli.ts bindNativeToExecutor --amount <amount>
# Options:
#   -a, --amount <amount>  Amount to binding
```

Bind `amount` native token to FHEExecutor (only owner).

#### releaseNativeFromExecutor

```sh
npx tsx src/privy-cli.ts releaseNativeFromExecutor --amount <amount>
# Options:
#   -a, --amount <amount>  Amount to releasing
```

Release `amount` native token from FHEExecutor (only owner).

#### balanceOfNative

```sh
npx tsx src/privy-cli.ts balanceOfNative
```
Returns the value of tokens owned by `deployer` of FHEExecutor (only owner).



### ERC20

#### name

```sh
npx tsx src/privy-cli.ts name
```

Returns the name of the token.

e.g.
```
# npx tsx src/privy-cli.ts name
Token name: Privy Token V2.1
```


#### symbol

```sh
npx tsx src/privy-cli.ts symbol
```

Returns the symbol of the token, a shorter version of the name.

e.g.
```
# npx tsx src/privy-cli.ts symbol
Token symbol: PRIVY
```

#### decimals

```sh
npx tsx src/privy-cli.ts decimals
```

Returns the number of decimals used to get its user representation.

e.g.
```
# npx tsx src/privy-cli.ts decimals
Token decimals: 18n
```


#### totalSupply

```sh
npx tsx src/privy-cli.ts totalSupply
```

Returns the value of tokens in existence.

*Only the **PRIVYToken** contract owner (and users on the whitelist) have the permission to decrypt.*


#### balance

```sh
npx tsx src/privy-cli.ts balanceOf --account <address>
# Options:
#   --account <address>  Account address
```

Returns the value of tokens owned by `account`.


*Only the `account` owner (and users on the whitelist) have the permission to decrypt.*


#### allowance

```sh
npx tsx src/privy-cli.ts allowance --owner <address> --spender <address>
# Options:
#   --owner <address>    Owner address
#   --spender <address>  Spender address
```

Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner` through **transferFrom**.

*Only the `owner` owner and `spender` owner (and users on the whitelist) have the permission to decrypt.*


#### mint

```sh
npx tsx src/privy-cli.ts mint --amount <value>
# Options:
#   --amount <value>  Token amount (human-readable)
```

Creates a value `amount` of tokens and assigns them to msg.sender, by transferring it from address(0).


#### burn
```sh
npx tsx src/privy-cli.ts burn --amount <value>
# Options:
#   --amount <value>  Token amount (human-readable)
```

Destroys a value `amount` of tokens from msg.sender, lowering the balance of msg.sender and the total supply.


#### transfer

```sh
npx tsx src/privy-cli.ts transfer --to <address> --amount <value>
# Options:
# --to <address>    Recipient address
# --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from the caller's account to `to`.

> Note for `--amount <value>`: `--amount 1.5` means `1.5 * 10 ^ decimals`.


#### approve

```sh
npx tsx src/privy-cli.ts approve --spender <address> --amount <value>
# Options:
#   --spender <address>  Spender address
#   --amount <value>     Token amount (human-readable)
```

Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.


#### transferFrom

```sh
npx tsx src/privy-cli.ts transferFrom --from <address> --to <address> --amount <value>
# Options:
#   --from <address>  Sender address
#   --to <address>    Recipient address
#   --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism. `value` is then deducted from the caller's allowance.


### Whitelist


#### transferOwnership

```sh
npx tsx src/privy-cli.ts transferOwnership --to <address>
# Options:
#   --to <address>  The account of new owner
```

Transfers the contract ownership to `to`.


#### addToWhitelist

```sh
npx tsx src/privy-cli.ts addToWhitelist --account <address>
# Options:
#   --account <address>  The account to add to whitelist
```

Adds an `account` to the whitelist.


#### removeFromWhitelist

```sh
npx tsx src/privy-cli.ts removeFromWhitelist --account <address>
# Options:
#   --account <address>  The account to remove from whitelist
```

Removes an `account` from the whitelist.


#### isWhitelisted

```sh
npx tsx src/privy-cli.ts isWhitelisted --account <address>
# Options:
#   --account <address>  The account address
```

Determines whether the `account` is on the whitelist.


#### getFullWhitelist

```sh
npx tsx src/privy-cli.ts getFullWhitelist
```

Retrieves the whitelist.


#### getTotalHandles

```sh
npx tsx src/privy-cli.ts getTotalHandles
```

Retrieves all handles for contract status variables, including historical values.




### Decryption

#### allowForDecryption

```sh
npx tsx src/privy-cli.ts allowForDecryption --handle <value> [--account <address>]
# Options:
#   --handle <value>     Ciphertext handle(bytes32)
#   --account <address>  The account to grant decryption permission to
```

Grants decryption permission for the `handle` to the specified `account`. If no `account` is provided, the `handle` will be decryptable by anyone.

<!-- 
#### encrypt

```sh
npx tsx src/privy-cli.ts encrypt --input <value>
# Options:
#   --input <value>  Plaintext value(integer)
```

Encrypts the `input` and return a `handle`.
-->


#### userDecrypt

```sh
npx tsx src/privy-cli.ts userDecrypt --handle <value>
# Options:
# --handle <value>  Ciphertext handle(bytes32)
```

Retrieves the plaintext corresponding to the `handle`.



