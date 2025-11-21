

- [Overview](#overview)
- [Access Control Specification](#access-control-specification)
  - [Encrypted MASS USD(eMUSD) Contract Deployment Information](#encrypted-mass-usdemusd-contract-deployment-information)
  - [Permission Roles](#permission-roles)
    - [Owner](#owner)
    - [Whitelisted Addresses](#whitelisted-addresses)
    - [User Wallet Addresses](#user-wallet-addresses)
- [Configuration](#configuration)
- [Commandline tool](#commandline-tool)
  - [ERC20](#erc20)
    - [name](#name)
    - [symbol](#symbol)
    - [decimals](#decimals)
    - [totalSupply](#totalsupply)
    - [balance](#balance)
    - [allowance](#allowance)
    - [deposit](#deposit)
    - [claim](#claim)
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

| Contract                  | Address                                    | Chain(ID)                       |
| ------------------------- | ------------------------------------------ | ------------------------------- |
| Encrypted MASS USD(eMUSD) | 0x106af0d6FF93924468c7742aE63278F1ad82a7CD | Sepolia Chain (11155111)        |


<br/>

**Encrypted MASS USD(eMUSD)** is an **FHE-based** token built on the standard ERC20 contract. It supports typical ERC20 functionality such as transferring tokens. Additionally, it supports whitelisting for regulatory purposes.

## Access Control Specification
### Encrypted MASS USD(eMUSD) Contract Deployment Information
- Contract Address: 0x106af0d6FF93924468c7742aE63278F1ad82a7CD
- Deployer Address (Owner): 0x6915B3e18c20be2f4393686B2025bE1B4474EF21

The deployer (Owner) holds the highest-level permissions and is responsible for all access control configurations within the contract.

### Permission Roles
#### Owner
The Owner is the top-level authority with the following capabilities:
- Can decrypt and view the balance of any address and the totalSupply.
- Manages global permissions, including:
  - Adding addresses to the whitelist
  - Removing addresses from the whitelist
- Transfer ownership to another address, allowing the administrative role to be safely handed over when required.

#### Whitelisted Addresses
Whitelisted addresses are trusted entities explicitly authorized by the Owner. They have the following permissions:
- Can decrypt and view the balance of any address and the totalSupply.

> Whitelisted roles are typically used for auditors, regulators, or business partners requiring full visibility.

#### User Wallet Addresses
Regular user wallets have the most limited permissions:
- They can only decrypt and view their own balance.
- They cannot view other users’ balances.
- They can only decrypt and view totalSupply.


<br/>

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
- node v22+

<br/>


**List all commands**

```sh
npx tsx src/pmusd-cli.ts help
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
  deposit [options]              Deposit a `amount` amount of tokens from erc20 to eMUSD contract.
  claim [options]                Claim a `amount` amount of tokens to `to`.
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
  userDecrypt [options]          Retrieves the plaintext corresponding to the `handle`.
  help [command]                 display help for command
```

### ERC20

#### name

```sh
npx tsx src/pmusd-cli.ts name
```

Returns the name of the token.

e.g.
```
# npx tsx src/pmusd-cli.ts name
Token name: Encrypted Mass USD Token
```


#### symbol

```sh
npx tsx src/pmusd-cli.ts symbol
```

Returns the symbol of the token, a shorter version of the name.

e.g.
```
# npx tsx src/pmusd-cli.ts symbol
Token symbol: eMUSD
```

#### decimals

```sh
npx tsx src/pmusd-cli.ts decimals
```

Returns the number of decimals used to get its user representation.

e.g.
```
# npx tsx src/pmusd-cli.ts decimals
Token decimals: 18n
```


#### totalSupply

```sh
npx tsx src/pmusd-cli.ts totalSupply
```

Returns the value of tokens in existence.

*Only the contract owner (and users on the whitelist) have the permission to decrypt.*


#### balance

```sh
npx tsx src/pmusd-cli.ts balanceOf --account <address>
# Options:
#   --account <address>  Account address
```

Returns the value of tokens owned by `account`.


*Only the `account` owner (and users on the whitelist) have the permission to decrypt.*


#### allowance

```sh
npx tsx src/pmusd-cli.ts allowance --owner <address> --spender <address>
# Options:
#   --owner <address>    Owner address
#   --spender <address>  Spender address
```

Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner` through **transferFrom**.

*Only the `owner` owner and `spender` owner (and users on the whitelist) have the permission to decrypt.*


#### deposit

**NOTE:** Before **deposit**, you should **approve** some `amount` to **eMUSD Contract** first.

```sh
npx tsx src/oz-cli.ts approve --spender <eMUSD_ADDRESS> --amount <amount>
```


```sh
npx tsx src/pmusd-cli.ts deposit --amount <amount>
# Options:
#   --amount <amount>  Amount to deposit
```

Deposit a `amount` amount of tokens from erc20 to eMUSD contract.


#### claim
```sh
npx tsx src/pmusd-cli.ts claim --to <address> --amount <amount>
# Options:
# -t, --to <address>     Recipient address
# -a, --amount <amount>  Amount to claim
```

Claim a `amount` amount of tokens to `to`.


#### transfer

```sh
npx tsx src/pmusd-cli.ts transfer --to <address> --amount <value>
# Options:
# --to <address>    Recipient address
# --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from the caller's account to `to`.

> Note for `--amount <value>`: `--amount 1.5` means `1.5 * 10 ^ decimals`.


#### approve

```sh
npx tsx src/pmusd-cli.ts approve --spender <address> --amount <value>
# Options:
#   --spender <address>  Spender address
#   --amount <value>     Token amount (human-readable)
```

Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.


#### transferFrom

```sh
npx tsx src/pmusd-cli.ts transferFrom --from <address> --to <address> --amount <value>
# Options:
#   --from <address>  Sender address
#   --to <address>    Recipient address
#   --amount <value>  Token amount (human-readable)
```

Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism. `value` is then deducted from the caller's allowance.


### Whitelist


#### transferOwnership

```sh
npx tsx src/pmusd-cli.ts transferOwnership --to <address>
# Options:
#   --to <address>  The account of new owner
```

Transfers the contract ownership to `to`.


#### addToWhitelist

```sh
npx tsx src/pmusd-cli.ts addToWhitelist --account <address>
# Options:
#   --account <address>  The account to add to whitelist
```

Adds an `account` to the whitelist.


#### removeFromWhitelist

```sh
npx tsx src/pmusd-cli.ts removeFromWhitelist --account <address>
# Options:
#   --account <address>  The account to remove from whitelist
```

Removes an `account` from the whitelist.


#### isWhitelisted

```sh
npx tsx src/pmusd-cli.ts isWhitelisted --account <address>
# Options:
#   --account <address>  The account address
```

Determines whether the `account` is on the whitelist.


#### getFullWhitelist

```sh
npx tsx src/pmusd-cli.ts getFullWhitelist
```

Retrieves the whitelist.


#### getTotalHandles

```sh
npx tsx src/pmusd-cli.ts getTotalHandles
```

Retrieves all handles for contract status variables, including historical values.




### Decryption

#### allowForDecryption

```sh
npx tsx src/pmusd-cli.ts allowForDecryption --handle <value> [--account <address>]
# Options:
#   --handle <value>     Ciphertext handle(bytes32)
#   --account <address>  The account to grant decryption permission to
```

Grants decryption permission for the `handle` to the specified `account`. If no `account` is provided, the `handle` will be decryptable by anyone.

<!-- 
#### encrypt

```sh
npx tsx src/pmusd-cli.ts encrypt --input <value>
# Options:
#   --input <value>  Plaintext value(integer)
```

Encrypts the `input` and return a `handle`.
-->


#### userDecrypt

```sh
npx tsx src/pmusd-cli.ts userDecrypt --handle <value>
# Options:
# --handle <value>  Ciphertext handle(bytes32)
```

Retrieves the plaintext corresponding to the `handle`.



