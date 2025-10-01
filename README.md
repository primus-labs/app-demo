

- [Overview](#overview)
- [Configuration](#configuration)
- [Commandline tool](#commandline-tool)
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
    - [decrypt](#decrypt)


## Overview

**Addresses (Sepolia):**

| Contract          | Address                                    |
| ----------------- | ------------------------------------------ |
| PrivyToken(PRIVY) | 0x7efBfe88982DDE3Cf2eA359A0dcc2D47f0A08a15 |

<br/>

**PrivyToken(PRIVY)** is an **FHE-based** token built on the standard ERC20 contract. It supports typical ERC20 functionality such as transferring tokens, minting. Additionally, it supports whitelisting for regulatory purposes.


## Configuration

- Copy `.env.sepolia` to `.env`.
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
- Ubuntu OS. (Currently only supports Ubuntu)
- node v22+

<br/>


**List all commands**

```sh
npm run main -- help
```

```log
Usage: [command] [options]

Options:
  -V, --version           output the version number
  -h, --help              display help for command

Commands:
  name                           Returns the name of the token.
  symbol                         Returns the symbol of the token, a shorter version of the name.
  decimals                       Returns the number of decimals used to get its user representation.
  totalSupply                    Returns the value of tokens in existence.
  balanceOf [options]            Returns the value of tokens owned by `account`.
  allowance [options]            Returns the remaining number of tokens that `spender` will be allowed to spend on behalf
                                 of `owner` through {transferFrom}.
  mint [options]                 Creates a value `amount` of tokens and assigns them to msg.sender, by transferring it
                                 from address(0).
  burn [options]                 Destroys a value `amount` of tokens from msg.sender, lowering the balance of msg.sender
                                 and the total supply.
  transfer [options]             Moves a value `amount` of tokens from the caller's account to `to`.
  approve [options]              Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.
  transferFrom [options]         Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism.
                                 `value` is then deducted from the caller's allowance.
  transferOwnership [options]    Transfers the contract ownership to `to`.
  addToWhitelist [options]       Adds an `account` to the whitelist.
  removeFromWhitelist [options]  Removes an `account` from the whitelist.
  isWhitelisted [options]        Determines whether the `account` is on the whitelist.
  getFullWhitelist               Retrieves the whitelist.
  getTotalHandles                Retrieves all handles for contract status variables, including historical values.
  allowForDecryption [options]   Grants decryption permission for the `handle` to the specified `account`. If no
                                 `account` is provided, the `handle` will be decryptable by anyone.
  decrypt [options]              Retrieves the plaintext corresponding to the `handle`.
  help [command]                 display help for command
```

### ERC20

#### name

```sh
npm run main -- name
```

Returns the name of the token.

e.g.
```
# npm run main -- name
Token name: Privy Token V2.1
```


#### symbol

```sh
npm run main -- symbol
```

Returns the symbol of the token, a shorter version of the name.

e.g.
```
# npm run main -- symbol
Token symbol: PRIVY
```

#### decimals

```sh
npm run main -- decimals
```

Returns the number of decimals used to get its user representation.

e.g.
```
# npm run main -- decimals
Token decimals: 18n
```


#### totalSupply

```sh
npm run main -- totalSupply
```

Returns the value of tokens in existence.

*Only the **PRIVYToken** contract owner (and users on the whitelist) have the permission to decrypt.*


#### balance

```sh
npm run main -- balanceOf --account <address>
# Options:
#   --account <address>  Account address
```

Returns the value of tokens owned by `account`.


*Only the `account` owner (and users on the whitelist) have the permission to decrypt.*


#### allowance

```sh
npm run main -- allowance --owner <address> --spender <address>
# Options:
#   --owner <address>    Owner address
#   --spender <address>  Spender address
```

Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner` through **transferFrom**.

*Only the `owner` owner and `spender` owner (and users on the whitelist) have the permission to decrypt.*


#### mint

```sh
npm run main -- mint --amount <value>
# Options:
#   --amount <value>  Token amount (human-readable)
```

Creates a value `amount` of tokens and assigns them to msg.sender, by transferring it from address(0).


#### burn
```sh
npm run main -- burn --amount <value>
# Options:
#   --amount <value>  Token amount (human-readable)
```

Destroys a value `amount` of tokens from msg.sender, lowering the balance of msg.sender and the total supply.


#### transfer

```sh
npm run main -- transfer --to <address> --amount <value>
# Options:
# --to <address>    Recipient address
# --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from the caller's account to `to`.

> Note for `--amount <value>`: `--amount 1.5` means `1.5 * 10 ^ decimals`.


#### approve

```sh
npm run main -- approve --spender <address> --amount <value>
# Options:
#   --spender <address>  Spender address
#   --amount <value>     Token amount (human-readable)
```

Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.


#### transferFrom

```sh
npm run main -- transferFrom --from <address> --to <address> --amount <value>
# Options:
#   --from <address>  Sender address
#   --to <address>    Recipient address
#   --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism. `value` is then deducted from the caller's allowance.


### Whitelist


#### transferOwnership

```sh
npm run main -- transferOwnership --to <address>
# Options:
#   --to <address>  The account of new owner
```

Transfers the contract ownership to `to`.


#### addToWhitelist

```sh
npm run main -- addToWhitelist --account <address>
# Options:
#   --account <address>  The account to add to whitelist
```

Adds an `account` to the whitelist.


#### removeFromWhitelist

```sh
npm run main -- removeFromWhitelist --account <address>
# Options:
#   --account <address>  The account to remove from whitelist
```

Removes an `account` from the whitelist.


#### isWhitelisted

```sh
npm run main -- isWhitelisted --account <address>
# Options:
#   --account <address>  The account address
```

Determines whether the `account` is on the whitelist.


#### getFullWhitelist

```sh
npm run main -- getFullWhitelist
```

Retrieves the whitelist.


#### getTotalHandles

```sh
npm run main -- getTotalHandles
```

Retrieves all handles for contract status variables, including historical values.




### Decryption

#### allowForDecryption

```sh
npm run main -- allowForDecryption --handle <value> [--account <address>]
# Options:
#   --handle <value>     Ciphertext handle(bytes32)
#   --account <address>  The account to grant decryption permission to
```

Grants decryption permission for the `handle` to the specified `account`. If no `account` is provided, the `handle` will be decryptable by anyone.

<!-- 
#### encrypt

```sh
npm run main -- encrypt --input <value>
# Options:
#   --input <value>  Plaintext value(integer)
```

Encrypts the `input` and return a `handle`.
-->


#### decrypt

```sh
npm run main -- decrypt --handle <value>
# Options:
# --handle <value>  Ciphertext handle(bytes32)
```

Retrieves the plaintext corresponding to the `handle`.



