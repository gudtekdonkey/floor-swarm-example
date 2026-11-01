export { PROGRAM_IDS } from "../generated/interface.gen.ts";
export const CHAIN_ROWS = [
    {
        "name": "solana",
        "label": "Solana",
        "family": "solana",
        "v2DayOne": true,
        "cluster": "mainnet-beta",
        "native": "SOL",
        "nativeName": "Solana",
        "rpcEnv": "FLOOR_RPC_SOLANA",
        "soak": {
            "cluster": "devnet",
            "rpcEnv": "FLOOR_RPC_SOLANA_DEVNET"
        },
        "explorer": {
            "name": "Solscan",
            "url": "https://solscan.io",
            "address": "/account/",
            "tx": "/tx/",
            "soak": {
                "url": "https://solscan.io",
                "query": "?cluster=devnet"
            }
        },
        "quotes": [
            {
                "symbol": "SOL",
                "name": "Solana",
                "address": "So11111111111111111111111111111111111111112",
                "decimals": 9,
                "kind": "native",
                "tokenProgram": "spl"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                "decimals": 6,
                "kind": "stable",
                "tokenProgram": "spl"
            },
            {
                "symbol": "USDT",
                "name": "Tether USD",
                "address": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                "decimals": 6,
                "kind": "stable",
                "tokenProgram": "spl"
            },
            {
                "symbol": "USD1",
                "name": "World Liberty USD",
                "address": "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
                "decimals": 6,
                "kind": "stable",
                "tokenProgram": "spl"
            },
            {
                "symbol": "PYUSD",
                "name": "PayPal USD",
                "address": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
                "decimals": 6,
                "kind": "stable",
                "tokenProgram": "token-2022"
            },
            {
                "symbol": "USDG",
                "name": "Global Dollar",
                "address": "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
                "decimals": 6,
                "kind": "stable",
                "tokenProgram": "token-2022"
            },
            {
                "symbol": "NEET",
                "name": "NEET",
                "address": "Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump",
                "decimals": 6,
                "kind": "meme",
                "tokenProgram": "spl"
            },
            {
                "symbol": "GIGA",
                "name": "GIGA",
                "address": "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9",
                "decimals": 5,
                "kind": "meme",
                "tokenProgram": "spl"
            },
            {
                "symbol": "WIF",
                "name": "dogwifhat",
                "address": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
                "decimals": 6,
                "kind": "meme",
                "tokenProgram": "spl"
            },
            {
                "symbol": "BONK",
                "name": "Bonk",
                "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
                "decimals": 5,
                "kind": "meme",
                "tokenProgram": "spl"
            },
            {
                "symbol": "FARTCOIN",
                "name": "Fartcoin",
                "address": "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
                "decimals": 6,
                "kind": "meme",
                "tokenProgram": "spl"
            }
        ]
    },
    {
        "name": "ethereum",
        "label": "Ethereum",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 1,
        "native": "ETH",
        "nativeName": "Ether",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_ETHEREUM",
        "soak": {
            "name": "sepolia",
            "chainId": 11155111,
            "rpcEnv": "FLOOR_RPC_SEPOLIA"
        },
        "explorer": {
            "name": "Etherscan",
            "url": "https://etherscan.io",
            "soak": {
                "url": "https://sepolia.etherscan.io"
            }
        },
        "quotes": [
            {
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDT",
                "name": "Tether USD",
                "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDS",
                "name": "USDS",
                "address": "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "DAI",
                "name": "Dai",
                "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "PYUSD",
                "name": "PayPal USD",
                "address": "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USD1",
                "name": "World Liberty USD",
                "address": "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "RLUSD",
                "name": "Ripple USD",
                "address": "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "USDG",
                "name": "Global Dollar",
                "address": "0xe343167631d89B6Ffc58B88d6b7fB0228795491D",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "PEPE",
                "name": "Pepe",
                "address": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
                "decimals": 18,
                "kind": "meme"
            },
            {
                "symbol": "SHIB",
                "name": "Shiba Inu",
                "address": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
                "decimals": 18,
                "kind": "meme"
            }
        ]
    },
    {
        "name": "base",
        "label": "Base",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 8453,
        "native": "ETH",
        "nativeName": "Ether",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_BASE",
        "soak": {
            "name": "base-sepolia",
            "chainId": 84532,
            "rpcEnv": "FLOOR_RPC_BASE_SEPOLIA"
        },
        "explorer": {
            "name": "BaseScan",
            "url": "https://basescan.org",
            "soak": {
                "url": "https://sepolia.basescan.org"
            }
        },
        "quotes": [
            {
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDT",
                "name": "Tether USD",
                "address": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "AAPLc",
                "name": "Apple Inc.",
                "address": "0xb200000000000000000000c2e324d24d7eecd1fb",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "AMZNc",
                "name": "Amazon.com Inc.",
                "address": "0xb200000000000000000000d9192b6b456483c2e8",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "GOOGLc",
                "name": "Alphabet Inc.",
                "address": "0xb2000000000000000000002d0ba3164cc74f58b7",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "METAc",
                "name": "Meta Platforms Inc.",
                "address": "0xb2000000000000000000008bc8786b856e61707c",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "MSFTc",
                "name": "Microsoft Corporation",
                "address": "0xb200000000000000000000ab99cfa739e253872b",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "MSTRc",
                "name": "Strategy Inc.",
                "address": "0xb2000000000000000000004884b426556b92883d",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "NVDAc",
                "name": "NVIDIA Corporation",
                "address": "0xb20000000000000000000078ee7ce2fe4908108c",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "SNDKc",
                "name": "Sandisk Corporation",
                "address": "0xb200000000000000000000397293cb8cda9a10c5",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "SPCXc",
                "name": "Space Exploration Technologies Corp.",
                "address": "0xb2000000000000000000007b9fcbd005511acbd5",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            },
            {
                "symbol": "TSLAc",
                "name": "Tesla Inc.",
                "address": "0xb2000000000000000000001e800a7f5189430cd0",
                "decimals": 8,
                "kind": "stock",
                "deferred": true
            }
        ]
    },
    {
        "name": "bsc",
        "label": "BNB Chain",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 56,
        "native": "BNB",
        "nativeName": "BNB",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_BSC",
        "soak": {
            "name": "bsc-testnet",
            "chainId": 97,
            "rpcEnv": "FLOOR_RPC_BSC_TESTNET"
        },
        "explorer": {
            "name": "BscScan",
            "url": "https://bscscan.com",
            "soak": {
                "url": "https://testnet.bscscan.com"
            }
        },
        "quotes": [
            {
                "symbol": "BNB",
                "name": "BNB",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "USDT",
                "name": "Tether USD",
                "address": "0x55d398326f99059fF775485246999027B3197955",
                "decimals": 18,
                "kind": "stable"
            },
            {
                "symbol": "USD1",
                "name": "World Liberty USD",
                "address": "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
                "decimals": 18,
                "kind": "stable"
            }
        ]
    },
    {
        "name": "arbitrum",
        "label": "Arbitrum",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 42161,
        "native": "ETH",
        "nativeName": "Ether",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_ARBITRUM",
        "soak": {
            "name": "arbitrum-sepolia",
            "chainId": 421614,
            "rpcEnv": "FLOOR_RPC_ARBITRUM_SEPOLIA"
        },
        "explorer": {
            "name": "Arbiscan",
            "url": "https://arbiscan.io",
            "soak": {
                "url": "https://sepolia.arbiscan.io"
            }
        },
        "quotes": [
            {
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDT0",
                "name": "USDT0",
                "address": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
                "decimals": 6,
                "kind": "stable"
            }
        ]
    },
    {
        "name": "arc",
        "label": "Arc",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 5042,
        "native": "USDC",
        "nativeName": "USD Coin",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_ARC",
        "soak": {
            "name": "arc-testnet",
            "chainId": 5042002,
            "rpcEnv": "FLOOR_RPC_ARC_TESTNET"
        },
        "explorer": {
            "name": "ArcScan",
            "url": "https://arcscan.app",
            "soak": {
                "url": "https://testnet.arcscan.app"
            }
        },
        "quotes": [
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            }
        ]
    },
    {
        "name": "robinhood",
        "label": "Robinhood Chain",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 4663,
        "native": "ETH",
        "nativeName": "Ether",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_ROBINHOOD",
        "soak": {
            "name": "robinhood-testnet",
            "chainId": 46630,
            "rpcEnv": "FLOOR_RPC_ROBINHOOD_TESTNET"
        },
        "explorer": {
            "name": "Robinhood Chain Explorer",
            "url": "https://explorer.robinhood.com",
            "soak": {
                "url": "https://explorer.testnet.chain.robinhood.com"
            }
        },
        "quotes": [
            {
                "symbol": "ETH",
                "name": "Ether",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDG",
                "name": "Global Dollar",
                "address": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "WOJAK",
                "name": "WOJAK",
                "address": "0x806ba27b5e1c4c2e989a3757a8def9fe1145ed10",
                "decimals": 18,
                "kind": "meme"
            },
            {
                "symbol": "AI",
                "name": "AI",
                "address": "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18",
                "decimals": 18,
                "kind": "meme"
            },
            {
                "symbol": "PONS",
                "name": "PONS",
                "address": "0x39dBED3a2bd333467115dE45665cC57F813C4571",
                "decimals": 18,
                "kind": "meme"
            }
        ]
    },
    {
        "name": "hyperevm",
        "label": "HyperEVM",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 999,
        "native": "HYPE",
        "nativeName": "Hype",
        "floorAmmAddress": null,
        "rpcEnv": "FLOOR_RPC_HYPEREVM",
        "soak": {
            "name": "hyperevm-testnet",
            "chainId": 998,
            "rpcEnv": "FLOOR_RPC_HYPEREVM_TESTNET"
        },
        "explorer": {
            "name": "HyperEVMScan",
            "url": "https://hyperevmscan.io",
            "soak": {
                "url": "https://testnet.purrsec.com"
            }
        },
        "quotes": [
            {
                "symbol": "HYPE",
                "name": "Hype",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18,
                "kind": "native"
            },
            {
                "symbol": "USDC",
                "name": "USD Coin",
                "address": "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDT0",
                "name": "USDT0",
                "address": "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "USDH",
                "name": "Hyperliquid USDH",
                "address": "0x111111a1a0667d36bD57c0A9f569b98057111111",
                "decimals": 6,
                "kind": "stable"
            },
            {
                "symbol": "wNVDAx",
                "name": "wNVDAx",
                "address": "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "wSPYx",
                "name": "wSPYx",
                "address": "0xe7e553cd128f0011777323a0b44a7b96ea1cb540",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "wQQQx",
                "name": "wQQQx",
                "address": "0x4c1ae29c159838fc1b224636e28e086eb69101f7",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "wSKHYx",
                "name": "wSKHYx",
                "address": "0x6215a58ed045d71f2561aaabe54f4c885c522998",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "wMUx",
                "name": "wMUx",
                "address": "0xe2047ee3bddb5c99ae428ab83df63f8730698e30",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "SPCX.dw",
                "name": "SPCX.dw",
                "address": "0x95687557c66bc799a850ba7037673528238ae763",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "AAPLd",
                "name": "AAPLd",
                "address": "0x7374dc1894fbd1bc6c42f6ebbc50b78c211a8606",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "MSFTd",
                "name": "MSFTd",
                "address": "0x66520d8fd614487214a25af7babf27584f59f76b",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "GOOGLd",
                "name": "GOOGLd",
                "address": "0x35eeda03e55ff217a013892e9e2e37e792b264ea",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "METAd",
                "name": "METAd",
                "address": "0x5a9d2deee7d8782011695623f1c453f46b2b566e",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "AMZNd",
                "name": "AMZNd",
                "address": "0x4f2164c12d2d450a8b1d430492ef6670fe4cad8e",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "HOODd",
                "name": "HOODd",
                "address": "0xc304a9d52cf9165024ebc7814250ef3a5013f924",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "CRCLd",
                "name": "CRCLd",
                "address": "0xe74aa6c4050a15790525eb11cc4562c664dc67c9",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "MUd",
                "name": "MUd",
                "address": "0x173c83a71c1a9e254721a86b7512cd65bf92648d",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "ORCLd",
                "name": "ORCLd",
                "address": "0xca2156522638f597ffb3705857ffdc356efabe50",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "AVGOd",
                "name": "AVGOd",
                "address": "0xc2785563af80c05177fff006e3b380ac5d172602",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "SPCXd",
                "name": "SPCXd",
                "address": "0xe8c8afdf7e80be51e91afa28b6ac44404d270b5d",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "SPYd",
                "name": "SPYd",
                "address": "0xb7bf37783db41a2851b77c6917280c56312c833a",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "QQQd",
                "name": "QQQd",
                "address": "0x499e347174f237ad28687b947b94c0d49570d1b7",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "GLDd",
                "name": "GLDd",
                "address": "0x08be08c37d93e689518ced744a89f113b4afaad4",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "SLVd",
                "name": "SLVd",
                "address": "0x7ef4eba0c0200957e357627ced1884d6cb63e961",
                "decimals": 18,
                "kind": "stock"
            },
            {
                "symbol": "BNBd",
                "name": "BNBd",
                "address": "0xfd6f06d323f6cb08ee9eeb2d201e9ec0e9112c88",
                "decimals": 18,
                "kind": "stock"
            }
        ]
    }
] as const;
