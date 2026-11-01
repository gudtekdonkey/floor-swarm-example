export function lockVested(amount: bigint, start: bigint, cliff: bigint, end: bigint, now: bigint, scale = 1n): bigint {
    if (now < cliff)
        return 0n;
    if (now >= end)
        return amount;
    return ((amount / scale) * (now - start)) / (end - start) * scale;
}
export function lockClaimable(l: {
    amount: bigint;
    claimed: bigint;
    start: bigint;
    cliff: bigint;
    end: bigint;
}, now: bigint, scale = 1n): bigint {
    const v = lockVested(l.amount, l.start, l.cliff, l.end, now, scale);
    return v > l.claimed ? v - l.claimed : 0n;
}
export function lockScheduleOk(amount: bigint, start: bigint, cliff: bigint, end: bigint, now: bigint): boolean {
    return amount > 0n && start <= cliff && cliff <= end && end > now;
}
