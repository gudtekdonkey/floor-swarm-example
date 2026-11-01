import { addressBytes, base58Encode, hex } from "../../codec.ts";
import { sha256 } from "../../sha256.ts";
import { launchPda } from "./program.ts";
import { metadataUri } from "./instructions.ts";
export const FLOOR_ORIGIN = "https://floor.supply";
export const WALLET_AUTH_PREFIX = "FLOOR metadata";
export const WALLET_AUTH_MESSAGE_HEADER = "x-floor-auth-message";
export const WALLET_AUTH_SIGNATURE_HEADER = "x-floor-auth-signature";
export const WALLET_AUTH_MAX_AHEAD_S = 300;
export const WALLET_AUTH_TTL_S = 120;
export const MAX_DESCRIPTION = 2000;
export const MAX_URL = 300;
export const MAX_HANDLE = 64;
export const MAX_IMAGE_BYTES = { avatar: 1024 * 1024, banner: 2 * 1024 * 1024 } as const;
export const SOCIAL_KEYS = ["x", "telegram", "discord", "github"] as const;
export type SolanaCluster = "mainnet" | "devnet";
export type ImageKind = keyof typeof MAX_IMAGE_BYTES;
export type ImageType = "image/png" | "image/jpeg" | "image/webp";
export type WalletAuthAction = "upload" | "meta";
export type Social = (typeof SOCIAL_KEYS)[number];
export interface CreatorSigner {
    address: string;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
}
export type Fetch = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array;
}) => Promise<{
    status: number;
    json(): Promise<unknown>;
}>;
export class LaunchMetadataError extends Error {
    readonly code: string;
    readonly status: number | undefined;
    constructor(code: string, message: string, status?: number) {
        super(message);
        this.name = "LaunchMetadataError";
        this.code = code;
        this.status = status;
    }
}
export { launchPda, metadataUri };
export const metadataBase = (cluster: SolanaCluster, origin = FLOOR_ORIGIN): string => `${origin.replace(/\/$/, "")}/api/meta/solana/${cluster}`;
export const chainParam = (cluster: SolanaCluster): string => `solana-${cluster}`;
const SITE = /^(?=.{1,253}(?::|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[1-9][0-9]{0,4})?$/;
function assertAddress(field: string, a: string): void {
    let ok = false;
    try {
        ok = addressBytes(a).length === 32 && base58Encode(addressBytes(a)) === a;
    }
    catch {
        ok = false;
    }
    if (!ok)
        throw new LaunchMetadataError("BadAddress", `${field} is not a base58 address in its canonical spelling`);
}
export function siteOf(origin: string): string {
    const site = new URL(origin).host.toLowerCase();
    const port = site.split(":")[1];
    if (!SITE.test(site) || (port !== undefined && Number(port) > 65535)) {
        throw new LaunchMetadataError("BadSite", `${origin} has no host the server can name`);
    }
    return site;
}
export function walletAuthMessage(f: {
    site: string;
    action: WalletAuthAction;
    cluster: SolanaCluster;
    launch: string;
    signer: string;
    bodySha256: string;
    expires: number;
}): string {
    if (!SITE.test(f.site))
        throw new LaunchMetadataError("BadSite", `site ${f.site} is not a lowercase host[:port]`);
    assertAddress("launch", f.launch);
    assertAddress("signer", f.signer);
    if (!/^[0-9a-f]{64}$/.test(f.bodySha256))
        throw new LaunchMetadataError("BadHash", "bodySha256 is not 64 lowercase hex");
    if (!Number.isSafeInteger(f.expires) || !/^[1-9][0-9]{0,10}$/.test(String(f.expires))) {
        throw new LaunchMetadataError("BadExpiry", "expires is not unix seconds");
    }
    return [
        WALLET_AUTH_PREFIX,
        `site: ${f.site}`,
        `action: ${f.action}`,
        `chain: ${chainParam(f.cluster)}`,
        `launch: ${f.launch}`,
        `signer: ${f.signer}`,
        `body-sha256: ${f.bodySha256}`,
        `expires: ${f.expires}`,
    ].join("\n");
}
export function walletAuthHeaders(message: string, signature: Uint8Array): Record<string, string> {
    if (signature.length !== 64)
        throw new LaunchMetadataError("BadSignature", "an ed25519 signature is 64 bytes");
    return { [WALLET_AUTH_MESSAGE_HEADER]: btoa(message), [WALLET_AUTH_SIGNATURE_HEADER]: base58Encode(signature) };
}
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
export function sniffImageType(b: Uint8Array): ImageType | null {
    const at = (sig: number[], off = 0) => sig.every((x, i) => b[off + i] === x);
    if (at([137, 80, 78, 71, 13, 10, 26, 10]))
        return "image/png";
    if (at([255, 216, 255]))
        return "image/jpeg";
    if (at([82, 73, 70, 70]) && at([87, 69, 66, 80], 8))
        return "image/webp";
    return null;
}
export function encodeUploadBody(f: {
    kind: ImageKind;
    launch: string;
    cluster: SolanaCluster;
    image: Uint8Array;
}, boundary: string): {
    body: Uint8Array;
    contentType: string;
} {
    const type = sniffImageType(f.image);
    if (type === null)
        throw new LaunchMetadataError("BadImage", `the ${f.kind} is not a PNG, JPEG or WebP`);
    if (f.image.length === 0 || f.image.length > MAX_IMAGE_BYTES[f.kind]) {
        throw new LaunchMetadataError("ImageTooLarge", `the ${f.kind} is at most ${MAX_IMAGE_BYTES[f.kind]} bytes`);
    }
    if (!/^[0-9A-Za-z-]{16,70}$/.test(boundary))
        throw new LaunchMetadataError("BadBoundary", "boundary must be 16-70 of [0-9A-Za-z-]");
    const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const ext = type === "image/jpeg" ? "jpg" : type.slice(6);
    const head = ascii(field("kind", f.kind) + field("launchAddress", f.launch) + field("chainId", chainParam(f.cluster)) +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.kind}.${ext}"\r\nContent-Type: ${type}\r\n\r\n`);
    const tail = ascii(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + f.image.length + tail.length);
    body.set(head, 0);
    body.set(f.image, head.length);
    body.set(tail, head.length + f.image.length);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
export interface LaunchMeta {
    description?: string | null;
    website?: string | null;
    socials?: Partial<Record<Social, string>>;
    avatarKey?: string | null;
    bannerKey?: string | null;
}
export function encodeLaunchMetaBody(m: LaunchMeta): Uint8Array {
    const description = m.description ?? null;
    if (description !== null && description.length > MAX_DESCRIPTION) {
        throw new LaunchMetadataError("BadDescription", `description is at most ${MAX_DESCRIPTION} characters`);
    }
    const website = m.website ?? null;
    if (website !== null) {
        if (website.length > MAX_URL)
            throw new LaunchMetadataError("BadWebsite", "website is too long");
        let ok = /^https?:\/\//i.test(website);
        try {
            new URL(website);
        }
        catch {
            ok = false;
        }
        if (!ok)
            throw new LaunchMetadataError("BadWebsite", "website must be an http(s) URL");
    }
    const socials: Partial<Record<Social, string>> = {};
    for (const k of SOCIAL_KEYS) {
        const v = m.socials?.[k];
        if (v == null || v === "")
            continue;
        const handle = v.trim().replace(/^@/, "").toLowerCase();
        if (handle.length > MAX_HANDLE)
            throw new LaunchMetadataError("BadSocial", `socials.${k} is at most ${MAX_HANDLE} characters`);
        socials[k] = handle;
    }
    return ascii(JSON.stringify({
        description,
        website,
        avatarKey: m.avatarKey ?? null,
        bannerKey: m.bannerKey ?? null,
        socials,
    }));
}
interface WriteContext {
    cluster: SolanaCluster;
    launch: string;
    signer: CreatorSigner;
    origin?: string;
    fetch?: Fetch;
    now?: () => number;
}
async function signedWrite(ctx: WriteContext, action: WalletAuthAction, method: string, path: string, body: Uint8Array, contentType: string): Promise<unknown> {
    const origin = (ctx.origin ?? FLOOR_ORIGIN).replace(/\/$/, "");
    const now = ctx.now ?? (() => Math.floor(Date.now() / 1000));
    const message = walletAuthMessage({
        site: siteOf(origin),
        action,
        cluster: ctx.cluster,
        launch: ctx.launch,
        signer: ctx.signer.address,
        bodySha256: hex(sha256(body)),
        expires: now() + WALLET_AUTH_TTL_S,
    });
    const signature = await ctx.signer.signMessage(ascii(message));
    const f = ctx.fetch ?? (globalThis.fetch as unknown as Fetch);
    const res = await f(`${origin}${path}`, {
        method,
        headers: { ...walletAuthHeaders(message, signature), "content-type": contentType },
        body,
    });
    let json: unknown = null;
    try {
        json = await res.json();
    }
    catch {
        json = null;
    }
    if (res.status !== 200) {
        const error = (json as {
            error?: unknown;
        } | null)?.error;
        throw new LaunchMetadataError("Refused", typeof error === "string" ? error : `HTTP ${res.status}`, res.status);
    }
    return (json as {
        result?: unknown;
    } | null)?.result;
}
export async function uploadLaunchImage(ctx: WriteContext & {
    kind: ImageKind;
    image: Uint8Array;
}): Promise<string> {
    const boundary = `floor-${hex(sha256(ctx.image)).slice(0, 24)}`;
    const { body, contentType } = encodeUploadBody({ kind: ctx.kind, launch: ctx.launch, cluster: ctx.cluster, image: ctx.image }, boundary);
    const result = await signedWrite(ctx, "upload", "POST", "/api/uploads", body, contentType);
    const key = (result as {
        key?: unknown;
    } | undefined)?.key;
    if (typeof key !== "string")
        throw new LaunchMetadataError("BadResponse", "the upload answered without a key");
    return key;
}
export function putLaunchMeta(ctx: WriteContext & {
    meta: LaunchMeta;
}): Promise<unknown> {
    return signedWrite(ctx, "meta", "PUT", `/api/meta/launches/${chainParam(ctx.cluster)}/${ctx.launch}`, encodeLaunchMetaBody(ctx.meta), "application/json");
}
export async function saveLaunchMetadata(input: {
    cluster: SolanaCluster;
    mint: string;
    signer: CreatorSigner;
    description?: string | null;
    website?: string | null;
    socials?: Partial<Record<Social, string>>;
    avatar?: Uint8Array;
    banner?: Uint8Array;
    programId?: string;
    origin?: string;
    fetch?: Fetch;
    now?: () => number;
}): Promise<{
    launch: string;
    avatarKey: string | null;
    bannerKey: string | null;
}> {
    assertAddress("mint", input.mint);
    const launch = launchPda(input.mint, input.programId)[0];
    const ctx: WriteContext = { cluster: input.cluster, launch, signer: input.signer, origin: input.origin, fetch: input.fetch, now: input.now };
    encodeLaunchMetaBody({ description: input.description, website: input.website, socials: input.socials });
    const avatarKey = input.avatar ? await uploadLaunchImage({ ...ctx, kind: "avatar", image: input.avatar }) : null;
    const bannerKey = input.banner ? await uploadLaunchImage({ ...ctx, kind: "banner", image: input.banner }) : null;
    await putLaunchMeta({ ...ctx, meta: { description: input.description, website: input.website, socials: input.socials, avatarKey, bannerKey } });
    return { launch, avatarKey, bannerKey };
}
