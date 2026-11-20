import { Address, beginCell, contractAddress, EMPTY_CELL } from "./cell.ts";
import type { Cell } from "./cell.ts";
import type { AddressLike, TonChain, TonCodes } from "./types.ts";
export function addr(a: AddressLike): Address {
    return typeof a === "string" ? Address.parse(a) : a;
}
export const factoryData = (authority: AddressLike, salt: bigint): Cell => beginCell().storeAddress(addr(authority)).storeUint(salt, 64).endCell();
export const launchData = (factory: AddressLike, id: bigint): Cell => beginCell().storeAddress(addr(factory)).storeUint(id, 64).endCell();
export const walletData = (owner: AddressLike, master: AddressLike, position: Cell = EMPTY_CELL): Cell => beginCell().storeCoins(0).storeAddress(addr(owner)).storeAddress(addr(master)).storeRef(position).endCell();
export const accountData = (launch: AddressLike, owner: AddressLike): Cell => beginCell().storeAddress(addr(launch)).storeAddress(addr(owner)).endCell();
export const traderData = (factory: AddressLike, trader: AddressLike): Cell => beginCell().storeAddress(addr(factory)).storeAddress(addr(trader)).endCell();
export function factoryAddress(codes: Pick<TonCodes, "factory">, authority: AddressLike, salt: bigint): Address {
    if (!codes.factory)
        throw new RangeError("factory init code not supplied");
    return contractAddress(codes.factory, factoryData(authority, salt));
}
export function launchAddress(chain: Pick<TonChain, "factory" | "codes">, id: bigint): Address {
    if (id < 1n)
        throw new RangeError("launch ids start at 1");
    if (!chain.codes.launch)
        throw new RangeError("launch init code not supplied: read the address with getLaunchAddress, or pass codes.launch");
    return contractAddress(chain.codes.launch, launchData(chain.factory, id));
}
export function launchWalletAddress(chain: Pick<TonChain, "codes">, launch: AddressLike, owner: AddressLike, position?: Cell): Address {
    return contractAddress(chain.codes.wallet, walletData(owner, launch, position));
}
export function accountAddress(chain: Pick<TonChain, "codes">, launch: AddressLike, owner: AddressLike): Address {
    return contractAddress(chain.codes.account, accountData(launch, owner));
}
export function traderAddress(chain: Pick<TonChain, "factory" | "codes">, trader: AddressLike): Address {
    return contractAddress(chain.codes.trader, traderData(chain.factory, trader));
}
