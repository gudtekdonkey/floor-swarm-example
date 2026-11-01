import { bytesToHex, checksumAddress, create2Address, encodeAbi, hexToBytes } from "./abi.ts";
import { keccak256 } from "./keccak.ts";
import type { ZapFamily } from "./zap.ts";
import { CHAIN_REGISTRY, EVM_CHAIN_SLUGS } from "../config/registry.gen.ts";
export type ChainKey = (typeof EVM_CHAIN_SLUGS)[number];
export interface ZapRouter {
    slot: string;
    amm: string;
    router: string;
    family: ZapFamily;
    confidence: "HIGH" | "MEDIUM" | "MEDIUM\u2013HIGH";
    optional: boolean;
    forkEncoding?: boolean;
}
export interface EvmChain {
    key: ChainKey;
    chainId: number;
    name: string;
    nativeSymbol: string;
    wrappedNative: string | null;
    zapRouters: readonly ZapRouter[];
    maxFloorHops?: number;
    v2DayOne?: false;
    notes: readonly string[];
}
function strict(a: string): string {
    const c = checksumAddress(a);
    const body = a.slice(2);
    if (body !== body.toLowerCase() && body !== body.toUpperCase() && a !== c)
        throw new RangeError(`${a} is not its EIP-55 checksum ${c}`);
    return c;
}
const r = (slot: string, amm: string, router: string, family: ZapFamily, confidence: ZapRouter["confidence"], optional = false, forkEncoding = false): ZapRouter => ({
    slot,
    amm,
    router: strict(router),
    family,
    confidence,
    optional,
    ...(forkEncoding ? { forkEncoding } : {}),
});
const UNISWAP_UR = "uniswap-ur";
const ROUTES: Record<ChainKey, Omit<EvmChain, "key" | "chainId" | "name" | "nativeSymbol">> = {
    ethereum: {
        wrappedNative: strict("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
        zapRouters: [r(UNISWAP_UR, "Uniswap v2/v3/v4", "0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA", "uniswap-ur", "HIGH")],
        notes: [],
    },
    base: {
        wrappedNative: strict("0x4200000000000000000000000000000000000006"),
        zapRouters: [
            r("aerodrome-ur", "Aerodrome V1 + Slipstream", "0xC5b6786D7B64767D775877b0B6A319AD946B11B5", "uniswap-ur", "HIGH", false, true),
            r(UNISWAP_UR, "Uniswap v2/v3/v4", "0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7", "uniswap-ur", "HIGH"),
            r("pancake-ur", "PancakeSwap V3 / Infinity", "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB", "uniswap-ur", "HIGH", true, true),
        ],
        notes: [],
    },
    bsc: {
        wrappedNative: strict("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
        zapRouters: [
            r("pancake-ur", "PancakeSwap V2 / V3 / Infinity", "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB", "uniswap-ur", "HIGH", false, true),
            r(UNISWAP_UR, "Uniswap v2/v3/v4", "0x8B844f885672f333Bc0042cB669255f93a4C1E6b", "uniswap-ur", "HIGH"),
        ],
        notes: ["\u26A0 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD is Uniswap's UR v1.2, NOT PancakeSwap's: never use it as Pancake's."],
    },
    arbitrum: {
        wrappedNative: strict("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
        zapRouters: [r(UNISWAP_UR, "Uniswap v2/v3/v4", "0x8B844f885672f333Bc0042cB669255f93a4C1E6b", "uniswap-ur", "HIGH")],
        notes: [],
    },
    hyperevm: {
        maxFloorHops: 2,
        wrappedNative: strict("0x5555555555555555555555555555555555555555"),
        zapRouters: [
            r("prjx", "Project X", "0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B", "v3-router", "MEDIUM\u2013HIGH"),
            r("nest", "nest (CL)", "0xaA26B8e5Cadd04430c32787eCC3AA325e99681e9", "algebra", "HIGH"),
            r("ramses-ur", "Ramses CL V2", "0xc43b33b5DF826A48DAE764817647824ED4f476a7", "uniswap-ur", "MEDIUM", false, true),
            r("hyperswap", "HyperSwap V3", "0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77", "v3-router02", "HIGH", true),
        ],
        notes: ["\u26A0 Small blocks cap a transaction at 3M gas: a buy that graduates a launch may need a big block."],
    },
    robinhood: {
        wrappedNative: strict("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
        zapRouters: [
            r(UNISWAP_UR, "Uniswap v2/v3/v4 (+ Fables v4 pools)", "0x8876789976dEcBfCbBbe364623C63652db8C0904", "uniswap-ur", "HIGH"),
            r("ramses-ur", "Ramses", "0xbFbb2BCBc9dfFA029C27A249ae9BE031E1d83b1C", "uniswap-ur", "HIGH", true, true),
        ],
        notes: [],
    },
    arc: {
        wrappedNative: null,
        zapRouters: [r(UNISWAP_UR, "Uniswap v4 (native-USDC pools)", "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1", "uniswap-ur", "HIGH")],
        notes: [
            "\u26A0 The native coin is USDC (18 dp at the EVM level; its ERC-20 view 0x3600000000000000000000000000000000000000 has 6 dp and no deposit()).",
            "\u26A0 No WETH9: WRAP_ETH does not apply; only v4 pools in address(0) take the native coin. The zap is for third-token quotes only.",
        ],
    },
};
export const EVM_CHAINS: Record<ChainKey, EvmChain> = Object.fromEntries(CHAIN_REGISTRY.flatMap((c) => (c.family === "evm" ? [[c.slug, { key: c.slug, chainId: c.chainId, name: c.label, nativeSymbol: c.native.symbol, ...ROUTES[c.slug], ...((c.v2DayOne as boolean) === false ? { v2DayOne: false as const } : {}) }]] : []))) as Record<ChainKey, EvmChain>;
export const v2DayOneChains = (): EvmChain[] => Object.values(EVM_CHAINS).filter((c) => c.v2DayOne !== false);
export const chainById = (chainId: number): EvmChain | null => Object.values(EVM_CHAINS).find((c) => c.chainId === chainId) ?? null;
export const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const salt = (s: string): string => bytesToHex(keccak256(new TextEncoder().encode(s)));
export const FLOOR_SALTS = {
    proxyBootstrap: salt("floor-amm.v2.proxy-bootstrap"),
    zapDeployer: salt("floor-amm.v2.zap-deployer"),
    routerDeployer: salt("floor-router.v2.router-deployer"),
} as const;
export const FLOOR_AMM_ADDRESS: string | null = null;
const cat = (...h: string[]): string => "0x" + h.map((x) => bytesToHex(hexToBytes(x)).slice(2)).join("");
const at = (s: string, init: string): string => create2Address({ deployer: CREATE2_FACTORY, salt: s, initCode: init });
export function floorAmmAddressV2(p: {
    deployer: string;
    proxySalt: string;
    code: {
        bootstrap: string;
        proxy: string;
    };
}): {
    bootstrap: string;
    floorAmm: string;
} {
    const bootstrap = at(FLOOR_SALTS.proxyBootstrap, cat(p.code.bootstrap, bytesToHex(encodeAbi(["address"], [p.deployer]))));
    const floorAmm = at(p.proxySalt, cat(p.code.proxy, bytesToHex(encodeAbi(["address", "bytes"], [bootstrap, "0x"]))));
    return { bootstrap, floorAmm };
}
export const tokenImplAddressV2 = (p: {
    salt: string;
    code: string;
}): string => at(p.salt, p.code);
export function zapDeployerAddressV2(p: {
    floorAmm: string;
    authority: string;
    code: string;
}): string {
    return at(FLOOR_SALTS.zapDeployer, cat(p.code, bytesToHex(encodeAbi(["address", "address"], [p.floorAmm, p.authority]))));
}
export function routerDeployerAddressV2(p: {
    floorAmm: string;
    authority: string;
    code: string;
}): string {
    return at(FLOOR_SALTS.routerDeployer, cat(p.code, bytesToHex(encodeAbi(["address", "address"], [p.floorAmm, p.authority]))));
}
export function eip1167CreationCode(impl: string): string {
    const a = impl.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(a))
        throw new RangeError("an implementation is a 20-byte address");
    return `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${a}5af43d82803e903d91602b57fd5bf3`;
}
export function launchTokenSalt(p: {
    sameAddressEverywhere: false;
    chainId: bigint;
    id: bigint;
} | {
    sameAddressEverywhere: true;
    creator: string;
    creatorSalt: string;
}): string {
    return p.sameAddressEverywhere
        ? bytesToHex(keccak256(encodeAbi(["address", "bytes32"], [p.creator, p.creatorSalt])))
        : bytesToHex(keccak256(encodeAbi(["uint256", "uint256"], [p.chainId, p.id])));
}
export function launchTokenAddress(p: {
    floorAmm: string;
    tokenImpl: string;
} & Parameters<typeof launchTokenSalt>[0]): string {
    return create2Address({ deployer: p.floorAmm, salt: launchTokenSalt(p), initCode: eip1167CreationCode(p.tokenImpl) });
}
