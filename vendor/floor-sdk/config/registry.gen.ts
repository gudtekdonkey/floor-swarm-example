export const CHAIN_REGISTRY = [
    {
        "slug": "solana",
        "label": "Solana",
        "family": "solana",
        "v2DayOne": true,
        "cluster": "mainnet-beta",
        "soakCluster": "devnet",
        "native": {
            "name": "Solana",
            "symbol": "SOL"
        }
    },
    {
        "slug": "ethereum",
        "label": "Ethereum",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 1,
        "soakChainId": 11155111,
        "native": {
            "name": "Ether",
            "symbol": "ETH"
        },
        "finality": "finalized",
        "reorgWindow": 65
    },
    {
        "slug": "base",
        "label": "Base",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 8453,
        "soakChainId": 84532,
        "native": {
            "name": "Ether",
            "symbol": "ETH"
        },
        "finality": "finalized",
        "reorgWindow": 65
    },
    {
        "slug": "bsc",
        "label": "BNB Chain",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 56,
        "soakChainId": 97,
        "native": {
            "name": "BNB",
            "symbol": "BNB"
        },
        "finality": "finalized",
        "reorgWindow": 65
    },
    {
        "slug": "arbitrum",
        "label": "Arbitrum",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 42161,
        "soakChainId": 421614,
        "native": {
            "name": "Ether",
            "symbol": "ETH"
        },
        "finality": "safe",
        "reorgWindow": 65
    },
    {
        "slug": "arc",
        "label": "Arc",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 5042,
        "soakChainId": 5042002,
        "native": {
            "name": "USD Coin",
            "symbol": "USDC"
        },
        "finality": "finalized",
        "reorgWindow": 65
    },
    {
        "slug": "robinhood",
        "label": "Robinhood Chain",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 4663,
        "soakChainId": 46630,
        "native": {
            "name": "Ether",
            "symbol": "ETH"
        },
        "finality": "safe",
        "reorgWindow": 65
    },
    {
        "slug": "hyperevm",
        "label": "HyperEVM",
        "family": "evm",
        "v2DayOne": true,
        "chainId": 999,
        "soakChainId": 998,
        "native": {
            "name": "Hype",
            "symbol": "HYPE"
        },
        "finality": "finalized",
        "reorgWindow": 65
    }
] as const;
export const CHAIN_SLUGS = ["solana", "ethereum", "base", "bsc", "arbitrum", "arc", "robinhood", "hyperevm"] as const;
export const EVM_CHAIN_SLUGS = ["ethereum", "base", "bsc", "arbitrum", "arc", "robinhood", "hyperevm"] as const;
